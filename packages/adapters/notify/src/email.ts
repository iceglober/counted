/**
 * Transactional email, via Resend.
 *
 * No SDK: one POST, and hand-rolling it keeps the request visible. The failure
 * mode being guarded against is an alert that silently never arrives, so the
 * response is checked and a non-2xx throws rather than being ignored.
 */

import type { Notification } from "@counted/ports";

export type EmailConfig = {
  readonly apiKey: string;
  /** A verified sending domain. Counted's is auth.counted.dev. */
  readonly from: string;
  readonly apiBase?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
};

export class EmailDeliveryError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`email provider returned ${status}: ${detail}`);
    this.name = "EmailDeliveryError";
  }
}

export const deliverEmail = async (
  notification: Extract<Notification, { channel: "email" }>,
  config: EmailConfig,
): Promise<void> => {
  const http = config.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const response = await http(`${config.apiBase ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: [notification.to],
        subject: notification.subject,
        // Plain text. An alert is not a newsletter, and HTML mail is one more
        // thing that can render wrongly in the client someone actually uses.
        text: notification.body,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new EmailDeliveryError(response.status, detail.slice(0, 200));
    }
  } finally {
    clearTimeout(timeout);
  }
};
