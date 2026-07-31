/**
 * Outbound webhooks, signed.
 *
 * Follows the Standard Webhooks scheme, which is worth adopting rather than
 * inventing: `webhook-id`, `webhook-timestamp`, and an HMAC over
 * `id.timestamp.body`. A receiver can verify it with a library it already has,
 * and we get the same replay window we require of Stripe's webhooks to us.
 *
 * The signature is over the **exact bytes sent**. Serialising once and signing
 * that string — rather than signing an object and serialising separately — is
 * what stops key order making a valid signature fail.
 */

import { createHmac } from "node:crypto";
import type { Notification } from "@counted/ports";

export type WebhookConfig = {
  /** Per-endpoint in time; one shared secret until endpoints are configurable. */
  readonly secret: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
};

/**
 * `v1,<base64 hmac>` — the Standard Webhooks signature format.
 *
 * Space-separated versions are allowed, so a secret can be rotated by sending
 * two. One is enough until endpoint secrets exist.
 */
export const signWebhook = (id: string, timestamp: number, body: string, secret: string): string => {
  const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
  return `v1,${signature}`;
};

export class WebhookDeliveryError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    // The host, not the full URL: a webhook path routinely carries a token,
    // and this message ends up in a log line and an outbox row.
    super(`webhook to ${safeHost(url)} returned ${status}`);
    this.name = "WebhookDeliveryError";
  }
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "an invalid url";
  }
};

export const deliverWebhook = async (
  notification: Extract<Notification, { channel: "webhook" }>,
  config: WebhookConfig,
): Promise<void> => {
  const http = config.fetch ?? fetch;
  const timestamp = Math.floor((config.now ?? (() => Date.now()))() / 1000);
  // Serialised once, signed and sent. Two serialisations could differ in key
  // order and the signature would not verify.
  const body = JSON.stringify(notification.payload);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const response = await http(notification.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Stable across redeliveries, so a receiver can drop the second copy.
        "webhook-id": notification.id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": signWebhook(notification.id, timestamp, body, config.secret),
        "user-agent": "Counted-Webhooks/1",
      },
      body,
      signal: controller.signal,
    });

    // Any non-2xx is a failure the outbox retries. A receiver that answers 4xx
    // is still saying it did not accept the event.
    if (!response.ok) throw new WebhookDeliveryError(response.status, notification.url);
  } finally {
    clearTimeout(timeout);
  }
};
