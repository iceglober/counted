import { describe, expect, test } from "bun:test";
import type { CreateEmailOptions, CreateEmailResponse } from "resend";
import { resendEmailSender, type ResendLike } from "./email";
import { NotificationDeliveryError } from "./errors";

const succeed = (): CreateEmailResponse => ({ data: { id: "re_1" }, error: null, headers: null });

/**
 * `error.name` is a closed union of Resend's own error codes. The cast is
 * confined to this helper so the tests can name a code as a plain string
 * without every call site carrying an assertion.
 */
const fail = (name: string, statusCode: number | null): CreateEmailResponse =>
  ({
    data: null,
    error: { message: "nope", name, statusCode },
    headers: null,
  }) as unknown as CreateEmailResponse;

const client = (
  respond: (payload: CreateEmailOptions) => CreateEmailResponse | Promise<never>,
): ResendLike & { sent: CreateEmailOptions[] } => {
  const sent: CreateEmailOptions[] = [];
  return {
    sent,
    emails: {
      send: async (payload: CreateEmailOptions): Promise<CreateEmailResponse> => {
        sent.push(payload);
        return await respond(payload);
      },
    },
  };
};

describe("resendEmailSender", () => {
  test("durable deliveries keep their provider idempotency key on every attempt", async () => {
    const keys: (string | undefined)[] = [];
    const resend: ResendLike = { emails: { send: async (_payload, options) => {
      keys.push(options?.idempotencyKey);
      return succeed();
    } } };
    const sender = resendEmailSender({ client: resend, from: "Counted <alerts@example.test>" });
    const message = { id: "monitor:breach:123:0", to: "test@example.test", subject: "Breach", body: "42 events" };
    await sender.send(message);
    await sender.send(message);
    expect(keys).toEqual([message.id, message.id]);
  });
  test("sends the body as text and never as html", async () => {
    // `Notification.body` is one untyped string assembled from customer data —
    // a workspace name, a monitor name. Rendered as HTML, a workspace called
    // `<img onerror=…>` becomes markup in somebody's inbox.
    const resend = client(succeed);
    await resendEmailSender({ client: resend, from: "Counted <a@b.test>" }).send({
      to: "who@example.test",
      subject: "Monitor breached",
      body: "<script>alert(1)</script>",
    });

    const payload = resend.sent[0];
    expect(payload).toBeDefined();
    expect((payload as { text?: string }).text).toBe("<script>alert(1)</script>");
    expect((payload as { html?: string }).html).toBeUndefined();
  });

  test("a refused send is a failure, not a resolved promise", async () => {
    // Resend resolves with `{ data: null, error }` rather than throwing. The
    // obvious three-line adapter awaits it and reports success for every
    // rejected recipient and every exhausted quota.
    const resend = client(() => fail("validation_error", 422));
    await expect(
      resendEmailSender({ client: resend, from: "a@b.test" }).send({
        to: "not-an-address",
        subject: "s",
        body: "b",
      }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });

  test("a bad API key is never retried; a rate limit is", async () => {
    const send = (name: string, status: number | null) =>
      resendEmailSender({ client: client(() => fail(name, status)), from: "a@b.test" }).send({
        to: "who@example.test",
        subject: "s",
        body: "b",
      });

    await expect(send("invalid_api_key", 401)).rejects.toMatchObject({ retryable: false });
    await expect(send("validation_error", null)).rejects.toMatchObject({ retryable: false });
    await expect(send("rate_limit_exceeded", 429)).rejects.toMatchObject({ retryable: true });
    await expect(send("application_error", 500)).rejects.toMatchObject({ retryable: true });
  });

  test("a thrown transport error is retryable", async () => {
    const resend = client(() => Promise.reject(new Error("socket hang up")) as Promise<never>);
    await expect(
      resendEmailSender({ client: resend, from: "a@b.test" }).send({
        to: "who@example.test",
        subject: "s",
        body: "b",
      }),
    ).rejects.toMatchObject({ retryable: true, channel: "email" });
  });

  test("replyTo is omitted rather than sent as undefined when unset", async () => {
    const resend = client(succeed);
    await resendEmailSender({ client: resend, from: "a@b.test" }).send({
      to: "who@example.test",
      subject: "s",
      body: "b",
    });
    expect("replyTo" in (resend.sent[0] as object)).toBe(false);
  });
});
