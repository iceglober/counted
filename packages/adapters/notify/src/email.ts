/**
 * Transactional email over Resend.
 *
 * Two things about this file are decisions rather than plumbing.
 *
 * **The body goes out as plain text, never as HTML.** `Notification` hands
 * over one `body: string` with no content type, and the strings that reach it
 * are assembled from customer-controlled data — a workspace name, a monitor
 * name, a project name. Rendering that as HTML means a workspace called
 * `<img onerror=…>` becomes markup in somebody's inbox. Text is not a
 * limitation we are working around; it is the only reading of an untyped
 * string that is safe by construction.
 *
 * **Resend does not throw.** `emails.send` resolves with `{ data, error }` and
 * a failed send is a resolved promise with `data: null`. Awaiting it and
 * moving on — which is what the obvious three-line adapter does — reports
 * success for every rejected recipient, every exhausted quota and every
 * revoked API key. The whole point of this wrapper is the `if (result.error)`.
 */

import type { CreateEmailOptions, CreateEmailResponse, CreateEmailRequestOptions } from "resend";
import { isRetryableStatus, NotificationDeliveryError } from "./errors";

export type EmailMessage = {
  readonly id?: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * The slice of the Resend client this adapter uses.
 *
 * Narrow on purpose: a test supplies four lines rather than a mock of a class
 * with twenty methods, and the compiler still checks the payload against the
 * vendor's own type, so a renamed field is caught here rather than at runtime.
 */
export interface ResendLike {
  readonly emails: {
    send(payload: CreateEmailOptions, options?: CreateEmailRequestOptions): Promise<CreateEmailResponse>;
  };
}

export type ResendEmailConfig = {
  readonly client: ResendLike;
  /** `"Counted <alerts@counted.dev>"`. Must be a verified sender on the account. */
  readonly from: string;
  readonly replyTo?: string;
};

/**
 * Resend's `error.name` values that mean "this will never work".
 *
 * Kept as a set rather than inferred from `statusCode`, because Resend reports
 * several of these with a null status — there is no HTTP response to read a
 * code from when the client rejected the request before sending it.
 */
const PERMANENT_ERRORS: ReadonlySet<string> = new Set([
  "invalid_api_key",
  "missing_api_key",
  "restricted_api_key",
  "validation_error",
  "invalid_from_address",
  "invalid_parameter",
  "invalid_attachment",
  "missing_required_field",
  "not_found",
  "method_not_allowed",
]);

export const resendEmailSender = (config: ResendEmailConfig): EmailSender => ({
  async send(message: EmailMessage): Promise<void> {
    const payload: CreateEmailOptions = {
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.body,
      ...(config.replyTo === undefined ? {} : { replyTo: config.replyTo }),
    };

    let response: CreateEmailResponse;
    try {
      response = await config.client.emails.send(payload, message.id === undefined ? undefined : { idempotencyKey: message.id });
    } catch (cause) {
      // A thrown error from the SDK is a transport failure — DNS, TLS, a
      // socket reset. Those are worth another attempt.
      throw new NotificationDeliveryError("email", `Email transport failed: ${describe(cause)}`, {
        retryable: true,
        cause,
      });
    }

    if (response.error !== null) {
      const { name, message: detail, statusCode } = response.error;
      throw new NotificationDeliveryError("email", `Resend refused the message: ${detail}`, {
        status: statusCode,
        retryable:
          !PERMANENT_ERRORS.has(name) &&
          (statusCode === null || isRetryableStatus(statusCode)),
      });
    }
  },
});

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
