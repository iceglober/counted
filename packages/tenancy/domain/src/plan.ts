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
 * That mapping belongs to `@counted/adapter-stripe`, keyed by `PlanId`.
 *
 * The API and console read their allowances from this catalog. Keep public
 * installation and pricing documentation consistent with these limits.
 */

import { assertNever } from "@counted/kernel";

export type PlanId = "free" | "pro";

export const PLAN_IDS: readonly PlanId[] = ["free", "pro"];

/**
 * Accepts an arbitrary string as a plan id, or does not.
 *
 * Needed because a plan id arrives from the wire and from Stripe metadata, and
 * both are outside our control. An unrecognised one is refused rather than
 * defaulted to `pro`.
 */
export const isPlanId = (raw: string): raw is PlanId =>
  (PLAN_IDS as readonly string[]).includes(raw);

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
    // Both plans allow unlimited members.
    seats: null,
    // "6 months" on the pricing page. 180 days is the coded reading of it;
    // calendar months are not a length (`Duration` has no `months` for the
    // same reason), so the published word and the enforced number differ by a
    // few days in February's favour.
    retentionDays: 180,
  },
};

const PRO: Plan = {
  id: "pro",
  name: "Pro",
  limits: {
    eventsPerMonth: 1_000_000,
    projects: null,
    // Both plans allow unlimited members.
    seats: null,
    // "24 months" on the pricing page; 730 days is exactly two years.
    retentionDays: 730,
  },
};

export const PlanCatalog = {
  free: FREE,
  pro: PRO,

  all: (): readonly Plan[] => [FREE, PRO],

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

  /** Whether a plan costs money. The catalog knows this; the price does not live here. */
  isPaid: (id: PlanId): boolean => id !== "free",
} as const;
