import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { Duration, Instant, isErr, isOk } from "@counted/kernel";
import { parseSignatureHeader, signPayload, verifyStripeSignature } from "./signature";

const SECRET = "whsec_ZmFrZS1zaWduaW5nLXNlY3JldC1mb3ItdGVzdHM";
const NOW = Instant.fromEpochMillis(1_735_689_600_000);
const BODY = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid" });

/**
 * Stripe's async signer. The sync one cannot run in this runtime — which is
 * the entire reason signature.ts exists — but the async one uses the same
 * scheme, so it is a genuine vendor-produced known-good input.
 */
const stripeHeader = (body: string, at: Instant, secret = SECRET): Promise<string> =>
  Stripe.webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret,
    timestamp: Math.floor(Instant.toEpochMillis(at) / 1000),
  });

describe("the finding this file exists for", () => {
  test("the Stripe SDK cannot verify a signature synchronously under this runtime", () => {
    // `BillingGateway.verifyWebhook` returns a Result, not a Promise. Under Bun
    // the stripe package resolves through its `bun` export condition to the
    // worker build, whose crypto provider is WebCrypto's async-only `subtle`.
    // If this test ever starts failing, the SDK has become usable on the
    // synchronous path and this package's hand-rolled verifier can be
    // reconsidered — which is why it asserts the failure rather than assuming it.
    expect(() =>
      Stripe.webhooks.constructEvent(BODY, "t=1,v1=deadbeef", SECRET),
    ).toThrow(/synchronous context/);

    expect(() => Stripe.createNodeCryptoProvider()).toThrow(/non-Node environments/);
  });
});

describe("verifyStripeSignature", () => {
  test("accepts a header Stripe itself produced", async () => {
    // The test that matters. Verifying our own signature proves only that we
    // are self-consistent; a self-consistently wrong implementation passes it
    // and then rejects every real delivery.
    const header = await stripeHeader(BODY, NOW);
    const result = verifyStripeSignature({ body: BODY, header, secret: SECRET, at: NOW });
    expect(isOk(result)).toBe(true);
  });

  test("Stripe accepts a header we produced", async () => {
    // The other direction, so the scheme is pinned from both ends.
    const header = signPayload(SECRET, BODY, NOW);
    const event = await Stripe.webhooks.constructEventAsync(
      BODY,
      header,
      SECRET,
      300,
      undefined,
      Instant.toEpochMillis(NOW),
    );
    expect(event.type).toBe("invoice.paid");
  });

  test("the secret is keyed as text, prefix included", async () => {
    // Stripe differs from Standard Webhooks here: the key is the whole
    // `whsec_…` string, not the base64 behind the prefix. Getting it wrong
    // produces a signature that never matches and looks like a wrong secret.
    const header = await stripeHeader(BODY, NOW);
    const decodedKey = Buffer.from(SECRET.slice("whsec_".length), "base64").toString("utf8");
    const wrong = verifyStripeSignature({ body: BODY, header, secret: decodedKey, at: NOW });
    expect(isErr(wrong)).toBe(true);
  });

  test("a tampered body is refused", async () => {
    const header = await stripeHeader(BODY, NOW);
    const result = verifyStripeSignature({
      body: BODY.replace("invoice.paid", "invoice.voided"),
      header,
      secret: SECRET,
      at: NOW,
    });
    expect(result).toEqual({ ok: false, error: { kind: "BadSignature" } });
  });

  test("re-serialised JSON does not verify, which is why the port takes raw bytes", async () => {
    // Reading the body with a JSON body parser and stringifying it again is the
    // single most common way to break this. Key order and whitespace both change.
    const header = await stripeHeader(BODY, NOW);
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyStripeSignature({ body: reserialised, header, secret: SECRET, at: NOW })).toEqual({
      ok: false,
      error: { kind: "BadSignature" },
    });
  });

  test("a different secret is refused", async () => {
    const header = await stripeHeader(BODY, NOW, "whsec_other");
    expect(verifyStripeSignature({ body: BODY, header, secret: SECRET, at: NOW })).toEqual({
      ok: false,
      error: { kind: "BadSignature" },
    });
  });

  test("a missing header is a bad signature, not a crash", () => {
    expect(verifyStripeSignature({ body: BODY, header: undefined, secret: SECRET, at: NOW })).toEqual(
      { ok: false, error: { kind: "BadSignature" } },
    );
    expect(verifyStripeSignature({ body: BODY, header: "", secret: SECRET, at: NOW })).toEqual({
      ok: false,
      error: { kind: "BadSignature" },
    });
  });

  test("a header with no v1 signature is malformed", () => {
    const result = verifyStripeSignature({
      body: BODY,
      header: "t=1735689600,v0=abcdef",
      secret: SECRET,
      at: NOW,
    });
    expect(isErr(result) && result.error.kind).toBe("Malformed");
  });

  test("a stale delivery reports how stale, which the SDK only puts in a message", async () => {
    const header = await stripeHeader(BODY, NOW);
    const late = Instant.plus(NOW, Duration.minutes(10));
    expect(verifyStripeSignature({ body: BODY, header, secret: SECRET, at: late })).toEqual({
      ok: false,
      error: { kind: "Stale", ageSeconds: 600 },
    });
  });

  test("a timestamp from the future is refused too", async () => {
    // Stripe's own check is one-sided. A captured delivery replayed with the
    // clock wound forward passes it.
    const header = await stripeHeader(BODY, Instant.plus(NOW, Duration.hours(2)));
    const result = verifyStripeSignature({ body: BODY, header, secret: SECRET, at: NOW });
    expect(isErr(result) && result.error.kind).toBe("Stale");
  });

  test("freshness is decided after the signature, never before", async () => {
    // The other order tells an attacker whether their forged body would
    // otherwise have verified.
    const header = await stripeHeader(BODY, Instant.minus(NOW, Duration.days(2)));
    expect(
      verifyStripeSignature({ body: "tampered", header, secret: SECRET, at: NOW }),
    ).toEqual({ ok: false, error: { kind: "BadSignature" } });
  });

  test("a wider tolerance accepts a replayed backfill", async () => {
    const header = await stripeHeader(BODY, Instant.minus(NOW, Duration.hours(6)));
    const result = verifyStripeSignature({
      body: BODY,
      header,
      secret: SECRET,
      at: NOW,
      tolerance: Duration.days(1),
    });
    expect(isOk(result)).toBe(true);
  });

  test("several v1 signatures verify if any matches — that is what makes secret rotation possible", async () => {
    const real = await stripeHeader(BODY, NOW);
    const parsed = parseSignatureHeader(real);
    expect(parsed).not.toBeNull();
    const rotating = `t=${parsed?.timestamp},v1=00000000,v1=${parsed?.signatures[0]}`;
    expect(isOk(verifyStripeSignature({ body: BODY, header: rotating, secret: SECRET, at: NOW }))).toBe(
      true,
    );
  });
});

describe("parseSignatureHeader", () => {
  test("returns null when the timestamp is missing", () => {
    expect(parseSignatureHeader("v1=abc")).toBeNull();
  });

  test("returns null when no v1 signature is present", () => {
    expect(parseSignatureHeader("t=1735689600")).toBeNull();
  });

  test("ignores unknown schemes rather than treating them as signatures", () => {
    // v0 appears on `stripe listen` forwarded events and is signed with a
    // different secret. Accepting it would verify against the wrong key.
    expect(parseSignatureHeader("t=1,v0=abc,v1=def")).toEqual({
      timestamp: 1,
      signatures: ["def"],
    });
  });
});
