/**
 * The two failures `BillingGateway` cannot express as a value.
 *
 * `createCheckoutSession` and `createPortalSession` return
 * `Promise<HostedSession>` — no `Result` — so a failure has to be thrown. Both
 * classes carry a `kind` that is already a row in V3-SPEC §6's billing table,
 * so `apps/api` maps them without inventing a third vocabulary:
 *
 *   ProviderUnavailable → BAD_GATEWAY (502)
 *   PlanUnavailable     → UNPROCESSABLE_CONTENT (422)
 *
 * `verifyWebhook` does return a `Result`, and nothing in this file is thrown
 * on that path. Webhook rejections are values.
 */

export class StripeProviderError extends Error {
  readonly kind = "ProviderUnavailable" as const;
  readonly detail: string;
  /** Stripe's HTTP status, when the failure got as far as a response. */
  readonly status: number | null;

  constructor(detail: string, options: { status?: number | null; cause?: unknown } = {}) {
    super(
      `Stripe is unavailable: ${detail}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "StripeProviderError";
    this.detail = detail;
    this.status = options.status ?? null;
  }
}

/**
 * Asked to sell a plan that has no price.
 *
 * Reachable because `BillingGateway<PlanId, …>` is generic over the whole plan
 * vocabulary, and `free` is in it. A free plan is not a checkout — it is what
 * you get by cancelling — so this is a refusal and not a provider fault. That
 * is why it is 422 rather than 502.
 */
export class PlanUnavailableError extends Error {
  readonly kind = "PlanUnavailable" as const;
  readonly plan: string;

  constructor(plan: string, reason: string) {
    super(`Cannot start checkout for plan "${plan}": ${reason}`);
    this.name = "PlanUnavailableError";
    this.plan = plan;
  }
}

const hasKind = (value: unknown, kind: string): boolean =>
  typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === kind;

export const isStripeProviderError = (value: unknown): value is StripeProviderError =>
  value instanceof StripeProviderError || hasKind(value, "ProviderUnavailable");

export const isPlanUnavailableError = (value: unknown): value is PlanUnavailableError =>
  value instanceof PlanUnavailableError || hasKind(value, "PlanUnavailable");
