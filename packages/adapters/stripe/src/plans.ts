/**
 * The plan ↔ price mapping. The only thing this adapter knows about a plan.
 *
 * `PlanCatalog` in `@counted/tenancy-domain` says what Pro includes. This file
 * says what Stripe calls it. v1 collapsed the two — `PLANS` lived inside
 * `lib/stripe.ts` with lazy env getters for the price ids — so answering "what
 * does Pro include?" required a Stripe key to be present, and three files ended
 * up with three answers to "is this customer on Pro?".
 *
 * Price ids are configuration, not code: they differ between test and live
 * mode, and a price is immutable in Stripe, so changing what Pro costs means a
 * new id. They arrive through `StripeBillingConfig`.
 */

import { PlanCatalog, type PlanId } from "@counted/tenancy-domain";

/**
 * The plans Stripe can be asked to sell.
 *
 * Derived from the catalog rather than written down, so adding a paid tier to
 * the domain makes this a compile error in the composition root — which is the
 * moment to notice a price id is missing, rather than at a customer's checkout.
 */
export type PaidPlanId = Exclude<PlanId, "free">;

export type Cadence = "monthly" | "annual";

/** One Stripe price id per paid plan per billing cadence. */
export type PlanPrices = {
  readonly [P in PaidPlanId]: { readonly [C in Cadence]: string };
};

export const isPaidPlan = (plan: PlanId): plan is PaidPlanId => PlanCatalog.isPaid(plan);

export const priceFor = (prices: PlanPrices, plan: PlanId, cadence: Cadence): string | null =>
  isPaidPlan(plan) ? prices[plan][cadence] : null;

/**
 * Which plan a Stripe price belongs to, or null.
 *
 * Null is a real answer and must stay one. A price we do not recognise — a
 * legacy price, a plan someone created in the Stripe dashboard, a coupon-bound
 * variant — means we cannot say what the customer bought, and guessing is how
 * a customer ends up entitled to something they did not pay for. The caller
 * turns a null into "recorded, not acted on".
 */
export const planForPrice = (prices: PlanPrices, priceId: string): PaidPlanId | null => {
  for (const plan of Object.keys(prices) as PaidPlanId[]) {
    const cadences = prices[plan];
    for (const cadence of Object.keys(cadences) as Cadence[]) {
      if (cadences[cadence] === priceId) return plan;
    }
  }
  return null;
};
