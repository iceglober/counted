import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import { fixedClock } from "@counted/kernel/ports";
import {
  DEFAULT_WEBHOOK_TOLERANCE,
  signedWebhookSender,
  signWebhook,
  verifyWebhookSignature,
  webhookSigningKey,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "./webhook";
import { NotificationDeliveryError } from "./errors";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const NOW = Instant.fromEpochMillis(1_700_000_000_000);
const TIMESTAMP = Math.floor(Instant.toEpochMillis(NOW) / 1000);

const received = (over: Partial<Parameters<typeof verifyWebhookSignature>[1]> = {}) => {
  const body = JSON.stringify({ kind: "monitor.breached", value: 42 });
  return {
    id: "evt_01",
    timestamp: String(TIMESTAMP),
    signature: signWebhook(SECRET, { id: "evt_01", timestamp: TIMESTAMP, body }),
    body,
    at: NOW,
    ...over,
  };
};

describe("webhookSigningKey", () => {
  test("a whsec_ secret signs with the bytes, not the base64 text", () => {
    // Signing the text produces a signature no compliant receiver can verify,
    // and the failure is indistinguishable from a wrong secret.
    const bytes = webhookSigningKey(SECRET);
    expect(bytes).toEqual(Buffer.from(SECRET.slice("whsec_".length), "base64"));
    expect(bytes.toString("utf8")).not.toBe(SECRET);
  });

  test("a secret without the prefix is used raw", () => {
    // What a self-hoster gets from `openssl rand -hex 32`.
    const raw = "0123456789abcdef";
    expect(webhookSigningKey(raw)).toEqual(Buffer.from(raw, "utf8"));
  });
});

describe("verifyWebhookSignature", () => {
  test("accepts what signWebhook produced", () => {
    expect(verifyWebhookSignature(SECRET, received())).toEqual({ kind: "Verified" });
  });

  test("the id is part of what is signed", () => {
    // Without it, two notifications with the same body are interchangeable —
    // an attacker can replay a delivery under a different event id and the
    // receiver's deduplication lets it through as new.
    expect(verifyWebhookSignature(SECRET, received({ id: "evt_02" }))).toEqual({
      kind: "BadSignature",
    });
  });

  test("the body is part of what is signed", () => {
    expect(
      verifyWebhookSignature(SECRET, received({ body: '{"kind":"monitor.breached","value":9001}' })),
    ).toEqual({ kind: "BadSignature" });
  });

  test("the timestamp is part of what is signed", () => {
    expect(verifyWebhookSignature(SECRET, received({ timestamp: String(TIMESTAMP - 1) }))).toEqual({
      kind: "BadSignature",
    });
  });

  test("a different secret does not verify", () => {
    expect(verifyWebhookSignature("whsec_AAAA", received())).toEqual({ kind: "BadSignature" });
  });

  test("a stale delivery is refused, and says how stale", () => {
    const at = Instant.plus(NOW, Duration.minutes(10));
    expect(verifyWebhookSignature(SECRET, received({ at }))).toEqual({
      kind: "Stale",
      ageSeconds: 600,
    });
  });

  test("a timestamp from the future is refused too", () => {
    // A receiver that only checks the past accepts a captured request replayed
    // with the clock wound forward.
    const at = Instant.minus(NOW, Duration.minutes(10));
    expect(verifyWebhookSignature(SECRET, received({ at }))).toEqual({
      kind: "Stale",
      ageSeconds: -600,
    });
  });

  test("staleness is decided after the signature, not before", () => {
    // Reversing the order leaks whether a forged body would have verified.
    const stale = received({
      at: Instant.plus(NOW, Duration.hours(1)),
      body: "tampered",
    });
    expect(verifyWebhookSignature(SECRET, stale)).toEqual({ kind: "BadSignature" });
  });

  test("a wider tolerance accepts what the default refuses", () => {
    const at = Instant.plus(NOW, Duration.minutes(10));
    expect(
      verifyWebhookSignature(SECRET, { ...received({ at }), tolerance: Duration.hours(1) }),
    ).toEqual({ kind: "Verified" });
    expect(Duration.toSeconds(DEFAULT_WEBHOOK_TOLERANCE)).toBe(300);
  });

  test("several offered signatures verify if any one matches — that is what makes rotation possible", () => {
    const base = received();
    const rotating = `v1,AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKK= ${base.signature}`;
    expect(verifyWebhookSignature(SECRET, { ...base, signature: rotating })).toEqual({
      kind: "Verified",
    });
  });

  test("a header with no v1 signature is malformed, not merely wrong", () => {
    expect(
      verifyWebhookSignature(SECRET, received({ signature: "v0,whatever" })).kind,
    ).toBe("Malformed");
  });

  test("a non-numeric timestamp is malformed", () => {
    expect(verifyWebhookSignature(SECRET, received({ timestamp: "yesterday" })).kind).toBe(
      "Malformed",
    );
  });
});

describe("signedWebhookSender", () => {
  const capture = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetchStub };
  };

  const headerOf = (init: RequestInit, name: string): string =>
    (init.headers as Record<string, string>)[name] as string;

  test("what it sends is what a receiver can verify", () => {
    // The round trip is the test worth having. Asserting the header is present
    // proves a header is present; asserting the verifier accepts it proves the
    // scheme is implemented on both sides the same way.
    const { calls, fetchStub } = capture();
    const sender = signedWebhookSender({ secret: SECRET, clock: fixedClock(NOW), fetch: fetchStub });

    return sender
      .send({ url: "https://example.test/hook", id: "evt_77", payload: { a: 1 } })
      .then(() => {
        const call = calls[0];
        expect(call).toBeDefined();
        const init = call?.init as RequestInit;
        expect(
          verifyWebhookSignature(SECRET, {
            id: headerOf(init, WEBHOOK_ID_HEADER),
            timestamp: headerOf(init, WEBHOOK_TIMESTAMP_HEADER),
            signature: headerOf(init, WEBHOOK_SIGNATURE_HEADER),
            body: init.body as string,
            at: NOW,
          }),
        ).toEqual({ kind: "Verified" });
      });
  });

  test("the notification's id travels as webhook-id, unchanged", async () => {
    // Delivery is at-least-once. A retry that mints a fresh id defeats the
    // receiver's deduplication, which is the only thing making that survivable.
    const { calls, fetchStub } = capture();
    const sender = signedWebhookSender({ secret: SECRET, clock: fixedClock(NOW), fetch: fetchStub });
    await sender.send({ url: "https://example.test/hook", id: "evt_77", payload: {} });
    await sender.send({ url: "https://example.test/hook", id: "evt_77", payload: {} });
    expect(calls.map((c) => headerOf(c.init, WEBHOOK_ID_HEADER))).toEqual(["evt_77", "evt_77"]);
  });

  test("a 5xx is retryable and a 4xx is not", async () => {
    const status = (code: number) =>
      (async () => new Response("", { status: code })) as unknown as typeof globalThis.fetch;

    const send = (code: number) =>
      signedWebhookSender({
        secret: SECRET,
        clock: fixedClock(NOW),
        fetch: status(code),
      }).send({ url: "https://example.test/hook", id: "e", payload: {} });

    await expect(send(503)).rejects.toMatchObject({ retryable: true, status: 503 });
    await expect(send(422)).rejects.toMatchObject({ retryable: false, status: 422 });
    // 429 is the 4xx that means "not now" rather than "not ever".
    await expect(send(429)).rejects.toMatchObject({ retryable: true, status: 429 });
  });

  test("a transport failure is retryable", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const sender = signedWebhookSender({ secret: SECRET, clock: fixedClock(NOW), fetch: boom });
    await expect(
      sender.send({ url: "https://example.test/hook", id: "e", payload: {} }),
    ).rejects.toMatchObject({ retryable: true, channel: "webhook" });
  });

  test("an unserialisable payload fails once and is never retried", async () => {
    const { fetchStub } = capture();
    const sender = signedWebhookSender({ secret: SECRET, clock: fixedClock(NOW), fetch: fetchStub });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = await sender
      .send({ url: "https://example.test/hook", id: "e", payload: circular })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotificationDeliveryError);
    expect((error as NotificationDeliveryError).retryable).toBe(false);
  });

  test("an undefined payload is signed as {} rather than the text 'undefined'", async () => {
    const { calls, fetchStub } = capture();
    const sender = signedWebhookSender({ secret: SECRET, clock: fixedClock(NOW), fetch: fetchStub });
    await sender.send({ url: "https://example.test/hook", id: "e", payload: undefined });
    expect(calls[0]?.init.body).toBe("{}");
  });
});
