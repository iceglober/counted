/**
 * @counted/adapter-notify — Notifier over email and webhooks.
 *
 * Delivery is at-least-once, so every notification carries a stable id sent as
 * `webhook-id`; the receiver's ability to deduplicate is part of what is being
 * delivered.
 *
 * Composition looks like this:
 *
 * ```ts
 * const notify = notifier({
 *   email: resendEmailSender({ client: new Resend(env.RESEND_API_KEY), from: env.MAIL_FROM }),
 *   webhook: signedWebhookSender({ secret: env.WEBHOOK_SIGNING_SECRET, clock: systemClock }),
 * });
 * ```
 *
 * The signing scheme is Standard Webhooks, and `verifyWebhookSignature` is
 * exported alongside the signer: a receiver has to be able to check what we
 * emit, and shipping only half the pair is how a signature becomes decoration.
 */

export {
  NotificationDeliveryError,
  isNotificationDeliveryError,
  isRetryableStatus,
  type NotificationChannel,
} from "./errors";

export {
  resendEmailSender,
  type EmailMessage,
  type EmailSender,
  type ResendEmailConfig,
  type ResendLike,
} from "./email";

export {
  signedWebhookSender,
  signWebhook,
  verifyWebhookSignature,
  webhookSigningKey,
  DEFAULT_WEBHOOK_TOLERANCE,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type SignedPayload,
  type SignedWebhookConfig,
  type WebhookMessage,
  type WebhookSender,
  type WebhookVerification,
} from "./webhook";

export { notifier, recordingNotifier, failingNotifier, type NotifierConfig } from "./notifier";
