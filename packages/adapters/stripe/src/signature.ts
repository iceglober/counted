/**
 * Stripe webhook signature verification, without the Stripe SDK.
 *
 * **Why not `stripe.webhooks.constructEvent`.** `BillingGateway.verifyWebhook`
 * is synchronous — it returns a `Result`, not a `Promise<Result>` — and under
 * Bun the `stripe` package resolves through its `bun` export condition to the
 * *worker* build, whose crypto provider is WebCrypto's `subtle`. `subtle` is
 * async-only, so every synchronous entry point throws:
 *
 *     CryptoProviderOnlySupportsAsyncError:
 *     SubtleCryptoProvider cannot be used in a synchronous context.
 *
 * `Stripe.createNodeCryptoProvider()` is the documented escape and the worker
 * build refuses it outright ("not available in non-Node environments"). Checked
 * against stripe@22.6.0 under bun 1.3.14 — both failures reproduced.
 *
 * So the scheme is implemented here, over `node:crypto`, which Bun supports
 * synchronously. It is thirty lines and Stripe documents it exactly:
 *
 *   header:          `t=<unix seconds>,v1=<hex>[,v1=<hex>][,v0=<hex>]`
 *   signed content:  `${t}.${rawBody}`
 *   signature:       HMAC-SHA256, keyed with the endpoint secret **as text**
 *
 * That last point is where Stripe differs from Standard Webhooks (which
 * base64-decodes the part after `whsec_`). Stripe keys with the whole secret
 * string including the prefix. Getting it wrong produces a signature that
 * never matches and looks exactly like a wrong secret.
 *
 * **Two behaviours are ours rather than the SDK's, and both are improvements.**
 * The age check uses the `at` the caller passed rather than `Date.now()`, so a
 * test states "this arrived ten minutes late" instead of sleeping. And a stale
 * delivery is reported as `Stale` with the actual age, where the SDK collapses
 * it into the same exception as a forged signature with the age only in an
 * English message.
 */

import { constantTimeEquals, hmacSha256Hex } from "@counted/adapter-crypto";
import { Duration, err, Instant, ok, type Result } from "@counted/kernel";
import type { WebhookRejection } from "@counted/tenancy-ports";

/**
 * Stripe's current scheme. `v0` appears on `stripe listen` forwarded events and
 * is signed with a different secret, so accepting it verifies against the
 * wrong key.
 */
const SCHEME = "v1";

/** Stripe's own default, and the value its docs tell receivers to use. */
export const DEFAULT_TOLERANCE = Duration.minutes(5);

export type StripeSignatureHeader = {
  /** Unix seconds, as Stripe sent it. */
  readonly timestamp: number;
  /** Every `v1=` value. More than one appears while an endpoint secret is being rotated. */
  readonly signatures: readonly string[];
};

export const parseSignatureHeader = (header: string): StripeSignatureHeader | null => {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed)) timestamp = parsed;
    } else if (key === SCHEME) {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
};

export type VerifiedSignature = {
  /** The instant Stripe signed the delivery, from the header. */
  readonly signedAt: Instant;
};

/**
 * Verify a raw body against its `stripe-signature` header.
 *
 * The order is signature first, freshness second, and it is not incidental:
 * checking the age of an unauthenticated timestamp first tells an attacker
 * whether their forged body would otherwise have verified.
 */
export const verifyStripeSignature = (request: {
  /** The bytes exactly as received. Re-serialised JSON has a different signature. */
  readonly body: string;
  readonly header: string | undefined;
  readonly secret: string;
  readonly at: Instant;
  readonly tolerance?: Duration;
}): Result<VerifiedSignature, WebhookRejection> => {
  if (request.header === undefined || request.header === "") {
    return err({ kind: "BadSignature" });
  }

  const parsed = parseSignatureHeader(request.header);
  if (parsed === null) {
    return err({
      kind: "Malformed",
      detail: "stripe-signature header has no timestamp or v1 signature",
    });
  }

  const expected = hmacSha256Hex(request.secret, `${parsed.timestamp}.${request.body}`);
  if (!parsed.signatures.some((candidate) => constantTimeEquals(candidate, expected))) {
    return err({ kind: "BadSignature" });
  }

  const tolerance = request.tolerance ?? DEFAULT_TOLERANCE;
  const ageSeconds = Math.floor(Instant.toEpochMillis(request.at) / 1000) - parsed.timestamp;
  if (Math.abs(ageSeconds) > Duration.toSeconds(tolerance)) {
    // Absolute value, so a timestamp from the future is refused too. A receiver
    // that only bounds the past accepts a captured delivery replayed with the
    // clock wound forward.
    return err({ kind: "Stale", ageSeconds });
  }

  return ok({ signedAt: Instant.fromEpochMillis(parsed.timestamp * 1000) });
};

/**
 * Produce a `stripe-signature` header. For tests and for the local
 * `stripe listen` equivalent — never on a request path.
 *
 * Exported for the same reason the verifier is: a scheme with no way to
 * generate a known-good input can only be tested against itself, and a
 * self-consistent wrong implementation passes that test.
 */
export const signPayload = (secret: string, body: string, at: Instant): string => {
  const timestamp = Math.floor(Instant.toEpochMillis(at) / 1000);
  return `t=${timestamp},${SCHEME}=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
};
