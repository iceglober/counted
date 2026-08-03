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

/**
 * Thrown when no mail provider is configured, instead of sending a request that
 * can only fail.
 *
 * Distinct from `EmailDeliveryError` so a caller can tell "nobody is set up to
 * send this" from "sending it failed" — the first is a development
 * environment, the second is an incident.
 */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super("No mail provider is configured (RESEND_API_KEY is unset).");
    this.name = "EmailNotConfiguredError";
  }
}

export const deliverEmail = async (
  notification: Extract<Notification, { channel: "email" }>,
  config: EmailConfig,
): Promise<void> => {
  // Refuse early rather than POST with an empty bearer token and take a 401.
  // A comment here used to claim sign-in was testable locally without a mail
  // provider "because the link is in the log" — it was not, and nothing logged
  // it. This is the half that makes that true; auth.ts is the other half.
  if (config.apiKey === "") throw new EmailNotConfiguredError();

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
