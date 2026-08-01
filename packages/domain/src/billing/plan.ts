/**
 * The plan catalog.
 *
 * This lives in the domain, not in the payment adapter. v1 put `PLANS` inside
 * `lib/stripe.ts` with lazy env getters for the price ids, so the vendor
 * effectively defined what a customer was allowed to do. Swapping Stripe out,
 * or answering "what does Pro include?" without a Stripe key present, both
 * required going through the billing integration.
 *
 * A price id is a *vendor reference to* a plan. It is not part of the plan.
 * That mapping belongs to the Stripe adapter, keyed by `PlanId`.
 */

import { assertNever } from "../shared/brand";

export type PlanId = "free" | "pro";

export const PLAN_IDS: readonly PlanId[] = ["free", "pro"];

/** `null` means unlimited. */
export type PlanLimits = {
  readonly eventsPerMonth: number | null;
  readonly projects: number | null;
  readonly seats: number | null;
  /** How long events are kept. Null means indefinitely. */
  readonly retentionDays: number | null;
};

export type Plan = {
  readonly id: PlanId;
  readonly name: string;
  readonly limits: PlanLimits;
};

const FREE: Plan = {
  id: "free",
  name: "Free",
  limits: {
    eventsPerMonth: 100_000,
    projects: 3,
    // Unlimited, deliberately — see PRO below for the reasoning.
    seats: null,
    // Advertised on the pricing page since launch and never implemented in v1
    // — there was no purge job and no retention column. The worker's
    // retention.purge job (#54) is what finally makes this true.
    retentionDays: 180,
  },
};

const PRO: Plan = {
  id: "pro",
  name: "Pro",
  limits: {
    eventsPerMonth: 1_000_000,
    projects: null,
    // Unlimited, deliberately.
    //
    // A cap was enforced here — 1 seat free, 10 pro — that no customer was
    // ever told about. `product_profile.md` is the stated source of truth for
    // pricing and has never had a seats row; neither has /pricing, which
    // lists events, projects, retention, dashboards, API access and support.
    // Counted bills on volume, not on people.
    //
    // Enforcing an unpublished limit is only latent because the teams UI is
    // deferred; the day it ships, the eleventh teammate is refused by a rule
    // that appears nowhere the customer could have read. Publishing the
    // numbers instead would have been the other honest option — this is the
    // one that matches what the product already claims to charge for.
    //
    // If seats ever become a pricing lever: restore the numbers *and* add
    // them to product_profile.md and /pricing in the same change.
    seats: null,
    retentionDays: 730,
  },
};

export const PlanCatalog = {
  free: FREE,
  pro: PRO,

  of: (id: PlanId): Plan => {
    switch (id) {
      case "free":
        return FREE;
      case "pro":
        return PRO;
      default:
        return assertNever(id);
    }
  },

  limitsFor: (id: PlanId): PlanLimits => PlanCatalog.of(id).limits,

  /** Is `a` at least as generous as `b` on every axis? Used to detect downgrades. */
  isAtLeast: (a: PlanId, b: PlanId): boolean => {
    const rank: Record<PlanId, number> = { free: 0, pro: 1 };
    return rank[a] >= rank[b];
  },
} as const;
