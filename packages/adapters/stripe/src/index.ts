/**
 * @counted/adapter-stripe — BillingGateway over Stripe. Tenancy only.
 *
 * Holds the PlanId → price id mapping, which is a vendor reference to a plan
 * and not part of the plan. Webhook verification takes the raw bytes: a
 * signature is computed over the body exactly as sent, and re-serialising JSON
 * changes it.
 *
 * Composition looks like this:
 *
 * ```ts
 * const billing = stripeBillingGateway({
 *   api: stripeClient({ secretKey: env.STRIPE_SECRET_KEY }),
 *   webhookSecret: env.STRIPE_WEBHOOK_SECRET,
 *   prices: { pro: { monthly: env.STRIPE_PRICE_PRO_MONTHLY, annual: env.STRIPE_PRICE_PRO_ANNUAL } },
 * });
 * ```
 *
 * Two things to know before using it.
 *
 * **The Stripe SDK does not verify signatures here.** `verifyWebhook` is
 * synchronous, and under Bun the SDK resolves to its worker build whose crypto
 * provider is async-only. The scheme is implemented over `node:crypto` in
 * signature.ts, with the reasoning and the reproduction written down there.
 *
 * **Checkout and portal throw; webhooks do not.** The port returns
 * `Promise<HostedSession>` for the first two, so `StripeProviderError` (502)
 * and `PlanUnavailableError` (422) are the only exceptions this package
 * raises. Every webhook outcome is a value.
 */

export {
  stripeBillingGateway,
  type CheckoutSessionParams,
  type PortalSessionParams,
  type StripeApi,
  type StripeBillingConfig,
} from "./gateway";

export { stripeClient, type StripeClientConfig } from "./client";

export {
  PlanUnavailableError,
  StripeProviderError,
  isPlanUnavailableError,
  isStripeProviderError,
} from "./errors";

export {
  DEFAULT_TOLERANCE,
  parseSignatureHeader,
  signPayload,
  verifyStripeSignature,
  type StripeSignatureHeader,
  type VerifiedSignature,
} from "./signature";

export { translateStripeEvent } from "./translate";

export {
  isPaidPlan,
  planForPrice,
  priceFor,
  type Cadence,
  type PaidPlanId,
  type PlanPrices,
} from "./plans";

export { METADATA_CADENCE, METADATA_PLAN, METADATA_WORKSPACE } from "./metadata";
