/**
 * `Notifier` — the two channels behind one method.
 *
 * `Notification` is a discriminated union, so this composes two senders rather
 * than branching on a string somewhere deeper. Which channel a notification
 * uses is decided by whoever built it; this file only routes.
 *
 * Delivery is one attempt. Retries belong to the outbox, which already holds a
 * durable row, an attempt count and a failure reason (`Outbox.recordFailure`).
 * A retry loop in here would be a second, invisible one — with its own
 * backoff, its own limit, and no record of either.
 */

import type { Notification, Notifier } from "@counted/kernel/ports";
import { assertNever } from "@counted/kernel";
import type { EmailSender } from "./email";
import type { WebhookSender } from "./webhook";
import { NotificationDeliveryError } from "./errors";

export type NotifierConfig = {
  readonly email: EmailSender;
  readonly webhook: WebhookSender;
};

export const notifier = (config: NotifierConfig): Notifier => ({
  async deliver(notification: Notification): Promise<void> {
    switch (notification.channel) {
      case "email":
        await config.email.send({
          to: notification.to,
          subject: notification.subject,
          body: notification.body,
        });
        return;
      case "webhook":
        await config.webhook.send({
          url: notification.url,
          id: notification.id,
          payload: notification.payload,
        });
        return;
      default:
        return assertNever(notification);
    }
  },
});

/**
 * A notifier that keeps what it was given and delivers nothing.
 *
 * For tests, and for a self-hosted deployment with no email provider
 * configured — where the honest behaviour is to drop the notification rather
 * than crash the request that produced it.
 */
export const recordingNotifier = (): Notifier & {
  readonly delivered: readonly Notification[];
} => {
  const delivered: Notification[] = [];
  return {
    delivered,
    deliver: async (notification: Notification): Promise<void> => {
      delivered.push(notification);
    },
  };
};

/**
 * A notifier that fails every delivery.
 *
 * Exists so the outbox's retry and dead-letter behaviour can be exercised
 * without a network, and so a misconfigured deployment fails loudly at the
 * first send instead of silently for a week.
 */
export const failingNotifier = (reason = "No notification transport configured"): Notifier => ({
  deliver: (notification: Notification): Promise<void> =>
    Promise.reject(
      new NotificationDeliveryError(notification.channel, reason, { retryable: false }),
    ),
});
