/**
 * Outbound webhooks, signed the way we would want to receive them.
 *
 * The scheme is Standard Webhooks (standardwebhooks.com) — the same three
 * headers Svix, better-auth and a growing number of providers emit, so a
 * customer receiving from Counted can verify with a library they already have
 * rather than a snippet we write for them.
 *
 *   webhook-id:         the notification id, stable across redeliveries
 *   webhook-timestamp:  unix seconds
 *   webhook-signature:  v1,<base64 hmac-sha256>  (space-separated if several)
 *
 * The signed content is `${id}.${timestamp}.${body}`, and every part of it
 * earns its place. Without the id, two different notifications with the same
 * body are interchangeable. Without the timestamp, a captured request can be
 * replayed forever. Without signing the body, the signature says nothing about
 * what was sent.
 *
 * `webhook-id` comes from `Notification`, not from this file, because delivery
 * is at-least-once: a retried outbox row must arrive with the id the receiver
 * already saw, or their deduplication does nothing.
 */

import { constantTimeEquals, hmacSha256Base64 } from "@counted/adapter-crypto";
import { Duration, Instant } from "@counted/kernel";
import type { Clock } from "@counted/kernel/ports";
import { isRetryableStatus, NotificationDeliveryError } from "./errors";

export const WEBHOOK_ID_HEADER = "webhook-id";
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

/** The only scheme version we emit or accept. */
const SCHEME = "v1";

/**
 * Turn a configured secret into signing key bytes.
 *
 * Standard Webhooks secrets are `whsec_` followed by base64 — the prefix marks
 * the kind of secret so one pasted into the wrong field is recognisable, and
 * the bytes behind it are the actual key. Signing the base64 *text* instead of
 * the bytes it encodes produces signatures that no compliant receiver can
 * verify, and the failure looks exactly like a wrong secret.
 *
 * A secret without the prefix is used as raw UTF-8, which is what a
 * self-hoster who generated one with `openssl rand -hex 32` will have.
 */
export const webhookSigningKey = (secret: string): Buffer =>
  secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");

export type SignedPayload = {
  readonly id: string;
  /** Unix seconds. Seconds, not millis — the spec says seconds and receivers parse it as such. */
  readonly timestamp: number;
  /** The exact bytes that will be sent, as a string. Re-serialising changes the signature. */
  readonly body: string;
};

const contentToSign = (payload: SignedPayload): string =>
  `${payload.id}.${payload.timestamp}.${payload.body}`;

/** The `webhook-signature` header value for one payload. */
export const signWebhook = (secret: string, payload: SignedPayload): string =>
  `${SCHEME},${hmacSha256Base64(webhookSigningKey(secret), contentToSign(payload))}`;

export type WebhookVerification =
  | { readonly kind: "Verified" }
  | { readonly kind: "BadSignature" }
  | { readonly kind: "Stale"; readonly ageSeconds: number }
  | { readonly kind: "Malformed"; readonly detail: string };

/** Five minutes each way, matching the reference implementations. */
export const DEFAULT_WEBHOOK_TOLERANCE = Duration.minutes(5);

/**
 * Verify a received webhook. Exported because a scheme nobody can check is a
 * scheme nobody should trust, and because our own tests are a receiver.
 *
 * The order matters: signature first, freshness second. Reversing it lets an
 * attacker learn whether a forged body would have verified by watching whether
 * they get "stale" or "bad signature".
 */
export const verifyWebhookSignature = (
  secret: string,
  received: {
    readonly id: string;
    readonly timestamp: string;
    readonly signature: string;
    readonly body: string;
    readonly at: Instant;
    readonly tolerance?: Duration;
  },
): WebhookVerification => {
  const timestamp = Number.parseInt(received.timestamp, 10);
  if (!Number.isSafeInteger(timestamp)) {
    return { kind: "Malformed", detail: "webhook-timestamp is not an integer" };
  }

  // Several signatures may be offered during a secret rotation; the header is
  // space-separated and one match is enough.
  const offered = received.signature
    .split(" ")
    .filter((part) => part.startsWith(`${SCHEME},`))
    .map((part) => part.slice(SCHEME.length + 1));

  if (offered.length === 0) {
    return { kind: "Malformed", detail: `no ${SCHEME} signature in webhook-signature` };
  }

  const expected = hmacSha256Base64(
    webhookSigningKey(secret),
    contentToSign({ id: received.id, timestamp, body: received.body }),
  );

  if (!offered.some((candidate) => constantTimeEquals(candidate, expected))) {
    return { kind: "BadSignature" };
  }

  const tolerance = received.tolerance ?? DEFAULT_WEBHOOK_TOLERANCE;
  const ageSeconds = Math.floor(Instant.toEpochMillis(received.at) / 1000) - timestamp;
  if (Math.abs(ageSeconds) > Duration.toSeconds(tolerance)) {
    // Absolute value, so a timestamp from the future is refused too. A receiver
    // that only checks the past accepts a captured request replayed with the
    // clock wound forward.
    return { kind: "Stale", ageSeconds };
  }

  return { kind: "Verified" };
};

export type WebhookMessage = {
  readonly url: string;
  readonly id: string;
  readonly payload: unknown;
};

export interface WebhookSender {
  send(message: WebhookMessage): Promise<void>;
}

export type SignedWebhookConfig = {
  readonly secret: string;
  readonly clock: Clock;
  /** Injectable so a test does not need a listening socket. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeout?: Duration;
  readonly userAgent?: string;
};

const DEFAULT_TIMEOUT = Duration.seconds(10);

export const signedWebhookSender = (config: SignedWebhookConfig): WebhookSender => {
  const send = config.fetch ?? globalThis.fetch;
  const timeoutMs = Duration.toMillis(config.timeout ?? DEFAULT_TIMEOUT);

  return {
    async send(message: WebhookMessage): Promise<void> {
      let serialised: string | undefined;
      try {
        serialised = JSON.stringify(message.payload) as string | undefined;
      } catch (cause) {
        // A payload that will not serialise is a bug in the caller, not a
        // transient condition. Retrying it forever is the wrong answer.
        throw new NotificationDeliveryError(
          "webhook",
          `Webhook payload is not serialisable: ${describe(cause)}`,
          { retryable: false, cause },
        );
      }
      // `JSON.stringify(undefined)` returns `undefined`, not a string — the
      // lib signature says `string` and is lying. An absent payload becomes an
      // empty object rather than a body of the literal text "undefined", which
      // is what the signature would otherwise be computed over.
      const body = serialised ?? "{}";

      const timestamp = Math.floor(Instant.toEpochMillis(config.clock.now()) / 1000);

      let response: Response;
      try {
        response = await send(message.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": config.userAgent ?? "Counted-Webhooks/1",
            [WEBHOOK_ID_HEADER]: message.id,
            [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
            [WEBHOOK_SIGNATURE_HEADER]: signWebhook(config.secret, {
              id: message.id,
              timestamp,
              body,
            }),
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new NotificationDeliveryError(
          "webhook",
          `Webhook POST to ${message.url} failed: ${describe(cause)}`,
          { retryable: true, cause },
        );
      }

      if (!response.ok) {
        throw new NotificationDeliveryError(
          "webhook",
          `Webhook POST to ${message.url} returned ${response.status}`,
          { status: response.status, retryable: isRetryableStatus(response.status) },
        );
      }
    },
  };
};

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
