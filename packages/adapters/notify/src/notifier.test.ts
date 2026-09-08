import { describe, expect, test } from "bun:test";
import type { Notification } from "@counted/kernel/ports";
import { failingNotifier, notifier, recordingNotifier } from "./notifier";
import type { EmailSender } from "./email";
import type { WebhookSender } from "./webhook";

const spies = () => {
  const emails: unknown[] = [];
  const webhooks: unknown[] = [];
  const email: EmailSender = { send: async (m) => void emails.push(m) };
  const webhook: WebhookSender = { send: async (m) => void webhooks.push(m) };
  return { emails, webhooks, notify: notifier({ email, webhook }) };
};

describe("notifier", () => {
  test("routes by channel and touches only the one channel", async () => {
    const { emails, webhooks, notify } = spies();
    await notify.deliver({
      channel: "email",
      to: "who@example.test",
      subject: "s",
      body: "b",
    });
    expect(emails).toHaveLength(1);
    expect(webhooks).toHaveLength(0);

    await notify.deliver({
      channel: "webhook",
      url: "https://example.test/h",
      id: "evt_1",
      payload: { a: 1 },
    });
    expect(webhooks).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  test("a failed send rejects rather than being swallowed", async () => {
    // The outbox drives retries off a rejected promise. A notifier that
    // absorbs the failure turns every retry into a no-op that reports success.
    const notify = notifier({
      email: {
        send: async () => {
          throw new Error("down");
        },
      },
      webhook: { send: async () => {} },
    });
    await expect(
      notify.deliver({ channel: "email", to: "a@b.test", subject: "s", body: "b" }),
    ).rejects.toThrow("down");
  });

  test("does not retry — one deliver is one attempt", async () => {
    let attempts = 0;
    const notify = notifier({
      email: {
        send: async () => {
          attempts += 1;
          throw new Error("down");
        },
      },
      webhook: { send: async () => {} },
    });
    await notify.deliver({ channel: "email", to: "a@b.test", subject: "s", body: "b" }).catch(
      () => {},
    );
    expect(attempts).toBe(1);
  });
});

describe("recordingNotifier", () => {
  test("keeps every notification in order", async () => {
    const notify = recordingNotifier();
    const one: Notification = { channel: "email", to: "a@b.test", subject: "1", body: "b" };
    const two: Notification = {
      channel: "webhook",
      url: "https://example.test/h",
      id: "evt",
      payload: {},
    };
    await notify.deliver(one);
    await notify.deliver(two);
    expect(notify.delivered).toEqual([one, two]);
  });
});

describe("failingNotifier", () => {
  test("fails loudly, so a misconfigured deployment is noticed at the first send", async () => {
    await expect(
      failingNotifier().deliver({ channel: "email", to: "a@b.test", subject: "s", body: "b" }),
    ).rejects.toMatchObject({ retryable: false, channel: "email" });
  });
});
