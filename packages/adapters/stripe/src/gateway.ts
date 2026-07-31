/**
 * Stripe's REST API, over fetch.
 *
 * No SDK. The surface we need is three calls and a signature check, the SDK
 * pulls in a large dependency for that, and hand-rolling the form encoding
 * keeps the request visible — which matters when the failure mode is "the
 * customer paid and got nothing".
 *
 * Stripe never decides an entitlement here. It is asked to host a checkout or
 * a portal page, and it reports payment state through webhooks. What a plan
 * entitles a workspace to is `PlanCatalog`'s, and nothing in this file knows.
 */

import { Instant, type WorkspaceId } from "@counted/domain";
import type {
  BillingGateway,
  CheckoutRequest,
  HostedSession,
  PortalRequest,
  VerifiedWebhook,
  WebhookRejection,
} from "@counted/ports";
import { translate, verifySignature } from "./webhook";

export type StripeConfig = {
  readonly secretKey: string;
  readonly webhookSecret: string;
  /** Price ids, so the catalog stays in the domain and the ids stay in config. */
  readonly prices: Readonly<Record<"monthly" | "annual", string>>;
  readonly apiBase?: string;
  readonly fetch?: typeof fetch;
  readonly toleranceSeconds?: number;
};

/** Stripe takes form encoding, including for nested fields. */
const form = (fields: Readonly<Record<string, string | undefined>>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) params.set(key, value);
  return params.toString();
};

export class StripeGateway implements BillingGateway {
  private readonly base: string;
  private readonly http: typeof fetch;

  constructor(private readonly config: StripeConfig) {
    this.base = config.apiBase ?? "https://api.stripe.com/v1";
    this.http = config.fetch ?? fetch;
  }

  private async post(path: string, body: string): Promise<Record<string, unknown>> {
    const response = await this.http(`${this.base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      // Surfaced, not swallowed. The caller turns this into a 502 the customer
      // can retry, rather than a checkout button that does nothing.
      const error = payload["error"] as { message?: string } | undefined;
      throw new Error(`stripe ${response.status}: ${error?.message ?? "request failed"}`);
    }
    return payload;
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<HostedSession> {
    const payload = await this.post(
      "/checkout/sessions",
      form({
        mode: "subscription",
        "line_items[0][price]": this.config.prices[request.cadence],
        "line_items[0][quantity]": "1",
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        ...(request.customer === null ? {} : { customer: request.customer }),
        // What the webhook reads back. Carrying the plan and the workspace in
        // metadata means the translation never has to infer them from a price
        // id, so adding a price cannot silently mean "unknown plan".
        "metadata[counted_workspace_id]": String(request.workspace),
        "metadata[counted_plan]": request.plan,
        "subscription_data[metadata][counted_workspace_id]": String(request.workspace),
        "subscription_data[metadata][counted_plan]": request.plan,
      }),
    );

    return {
      url: String(payload["url"] ?? ""),
      expiresAt:
        typeof payload["expires_at"] === "number" ? Instant.fromEpochMillis(payload["expires_at"] * 1000) : null,
    };
  }

  async createPortalSession(request: PortalRequest): Promise<HostedSession> {
    const payload = await this.post(
      "/billing_portal/sessions",
      form({ customer: request.customer, return_url: request.returnUrl }),
    );
    return { url: String(payload["url"] ?? ""), expiresAt: null };
  }

  verifyWebhook(
    body: string,
    signature: string | undefined,
    at: Instant,
  ): { ok: true; value: VerifiedWebhook } | { ok: false; error: WebhookRejection } {
    const verified = verifySignature(body, signature, at, {
      secret: this.config.webhookSecret,
      ...(this.config.toleranceSeconds === undefined ? {} : { toleranceSeconds: this.config.toleranceSeconds }),
    });
    if (!verified.ok) return verified;

    // Parsed only after the signature checks out. Parsing first would run our
    // JSON decoder over anything the internet sends.
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return { ok: false, error: { reason: "malformed", detail: "body is not valid JSON" } };
    }

    const translated = translate(payload);
    if (translated === null) {
      return { ok: false, error: { reason: "malformed", detail: "event has no id or type" } };
    }

    return {
      ok: true,
      value: {
        id: translated.id,
        type: translated.type,
        workspace: translated.workspace as WorkspaceId | null,
        event: translated.event,
      },
    };
  }
}
