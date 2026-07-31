/**
 * The Notifier port, satisfied.
 *
 * Dispatches by channel and does nothing else. Retries, attempt counting and
 * giving up all belong to the outbox job — a notifier that retried on its own
 * would be a second, invisible retry policy fighting the first.
 */

import type { Notification, Notifier } from "@counted/ports";
import { deliverEmail, type EmailConfig } from "./email";
import { deliverWebhook, type WebhookConfig } from "./webhook";

export type NotifierConfig = {
  readonly email: EmailConfig;
  readonly webhook: WebhookConfig;
};

export const createNotifier = (config: NotifierConfig): Notifier => ({
  async deliver(notification: Notification): Promise<void> {
    if (notification.channel === "email") return deliverEmail(notification, config.email);
    return deliverWebhook(notification, config.webhook);
  },
});
