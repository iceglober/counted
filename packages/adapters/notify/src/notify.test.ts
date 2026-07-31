/**
 * Signing and delivery.
 *
 * The signature tests matter for the same reason the Stripe ones do: a
 * receiver will verify what we send, and a scheme that is subtly wrong fails
 * only in production, on someone else's endpoint.
 */

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { Notification } from "@counted/ports";
import { EmailDeliveryError, WebhookDeliveryError, createNotifier, deliverEmail, deliverWebhook, signWebhook } from "./index";

const SECRET = "whsec_outbound";
const NOW = Date.parse("2026-03-17T15:00:00.000Z");

const webhook = (over: Partial<Extract<Notification, { channel: "webhook" }>> = {}) =>
  ({
    channel: "webhook" as const,
    url: "https://hooks.example.com/services/T0/B0/secretPath",
    id: "evt_1",
    payload: { type: "MonitorFired", data: { observed: 500 } },
    ...over,
  });

const email = (over: Partial<Extract<Notification, { channel: "email" }>> = {}) =>
  ({ channel: "email" as const, to: "ops@example.com", subject: "s", body: "b", ...over });

describe("a webhook is signed the way a receiver will verify it", () => {
  test("the signature is an HMAC over id.timestamp.body", () => {
    // Standard Webhooks. Worth following rather than inventing: a receiver can
    // verify it with a library it already has.
    const body = JSON.stringify({ a: 1 });
    const expected = createHmac("sha256", SECRET).update(`evt_1.${1000}.${body}`, "utf8").digest("base64");
    expect(signWebhook("evt_1", 1000, body, SECRET)).toBe(`v1,${expected}`);
  });

  test("changing anything changes the signature", () => {
    const base = signWebhook("evt_1", 1000, "{}", SECRET);
    expect(signWebhook("evt_2", 1000, "{}", SECRET)).not.toBe(base);
    expect(signWebhook("evt_1", 1001, "{}", SECRET)).not.toBe(base);
    expect(signWebhook("evt_1", 1000, "{ }", SECRET)).not.toBe(base);
    expect(signWebhook("evt_1", 1000, "{}", "other")).not.toBe(base);
  });

  test("the signature covers the exact bytes sent", async () => {
    // Serialised once, signed and sent. Signing an object and serialising
    // separately would let key order make a valid signature fail.
    let sent: { body: string; headers: Record<string, string> } | null = null;
    await deliverWebhook(webhook(), {
      secret: SECRET,
      now: () => NOW,
      fetch: (async (_url: unknown, init: RequestInit) => {
        sent = { body: String(init.body), headers: init.headers as Record<string, string> };
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });

    const { body, headers } = sent!;
    const timestamp = Number(headers["webhook-timestamp"]);
    expect(headers["webhook-signature"]).toBe(signWebhook("evt_1", timestamp, body, SECRET));
  });

  test("the id is sent, so a receiver can deduplicate a redelivery", async () => {
    // Delivery is at-least-once. This is what makes that survivable.
    let headers: Record<string, string> = {};
    await deliverWebhook(webhook({ id: "evt_stable" }), {
      secret: SECRET,
      fetch: (async (_u: unknown, init: RequestInit) => {
        headers = init.headers as Record<string, string>;
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(headers["webhook-id"]).toBe("evt_stable");
  });

  test("the timestamp is in seconds, as the scheme specifies", async () => {
    let headers: Record<string, string> = {};
    await deliverWebhook(webhook(), {
      secret: SECRET,
      now: () => NOW,
      fetch: (async (_u: unknown, init: RequestInit) => {
        headers = init.headers as Record<string, string>;
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(headers["webhook-timestamp"]).toBe(String(Math.floor(NOW / 1000)));
  });
});

describe("a webhook that is not accepted is a failure", () => {
  const responding = (status: number) =>
    deliverWebhook(webhook(), {
      secret: SECRET,
      fetch: (async () => new Response("", { status })) as unknown as typeof fetch,
    });

  test("any non-2xx throws, so the outbox retries", async () => {
    // A receiver answering 4xx is still saying it did not accept the event.
    for (const status of [400, 401, 404, 429, 500, 503]) {
      await expect(responding(status)).rejects.toBeInstanceOf(WebhookDeliveryError);
    }
  });

  test("2xx does not throw", async () => {
    for (const status of [200, 201, 202, 204]) await responding(status);
  });

  test("the error names the host, never the path", async () => {
    // A webhook path routinely carries a token, and this message ends up in a
    // log line and an outbox row.
    try {
      await responding(500);
      throw new Error("expected a failure");
    } catch (error) {
      expect((error as Error).message).toContain("hooks.example.com");
      expect((error as Error).message).not.toContain("secretPath");
    }
  });
});

describe("email", () => {
  test("it posts the message and checks the answer", async () => {
    let body: Record<string, unknown> = {};
    await deliverEmail(email(), {
      apiKey: "re_test",
      from: "alerts@counted.dev",
      fetch: (async (_u: unknown, init: RequestInit) => {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(body).toMatchObject({ from: "alerts@counted.dev", to: ["ops@example.com"], subject: "s", text: "b" });
  });

  test("a provider failure throws rather than being ignored", async () => {
    // The failure mode being guarded against is an alert that silently never
    // arrives.
    await expect(
      deliverEmail(email(), {
        apiKey: "re_test",
        from: "a@b.c",
        fetch: (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});

describe("the notifier dispatches by channel and does nothing else", () => {
  test("it routes email and webhooks to their own delivery", async () => {
    const seen: string[] = [];
    const notifier = createNotifier({
      email: {
        apiKey: "k",
        from: "f",
        fetch: (async () => {
          seen.push("email");
          return new Response("{}", { status: 200 });
        }) as unknown as typeof fetch,
      },
      webhook: {
        secret: SECRET,
        fetch: (async () => {
          seen.push("webhook");
          return new Response("", { status: 200 });
        }) as unknown as typeof fetch,
      },
    });

    await notifier.deliver(email());
    await notifier.deliver(webhook());
    expect(seen).toEqual(["email", "webhook"]);
  });

  test("it does not retry — that policy belongs to the outbox", async () => {
    // A notifier with its own retry would be a second, invisible policy
    // fighting the first.
    let calls = 0;
    const notifier = createNotifier({
      email: { apiKey: "k", from: "f" },
      webhook: {
        secret: SECRET,
        fetch: (async () => {
          calls += 1;
          return new Response("", { status: 500 });
        }) as unknown as typeof fetch,
      },
    });

    await expect(notifier.deliver(webhook())).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
