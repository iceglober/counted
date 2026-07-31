/**
 * Quota — whether a workspace may ingest more events right now.
 *
 * The decision is a value with three outcomes, and the caller must handle all
 * three. v1 had two outcomes that looked identical on the wire: over the hard
 * limit, ingestion returned **202 with the event silently discarded** — byte
 * for byte the same response as success. A customer could be losing every
 * event and see nothing but 202s.
 *
 * `overage` exists so that state is nameable. It is the band where events are
 * still accepted but the customer is past their allowance and should be told.
 */

import { assertNever } from "../shared/brand";
import type { Entitlement } from "./entitlement";

/**
 * How far past the allowance events keep flowing before ingestion stops.
 * Cutting a customer off at exactly 100% mid-month loses data over a rounding
 * error; 30% is enough room to notice an invoice.
 */
export const OVERAGE_MULTIPLE = 1.3;

/**
 * Events recorded so far in the current billing period.
 *
 * There is deliberately no `limit` here. The allowance comes from the
 * entitlement and nowhere else — an earlier draft let the caller pass one,
 * and `period.limit ?? entitlement.limits.eventsPerMonth` then read an
 * explicit `null` (meaning unlimited) as "not supplied" and silently applied
 * the plan's cap instead. Two sources for one number is how v1 ended up with
 * three definitions of "is this customer on Pro?".
 */
export type UsagePeriod = {
  readonly used: number;
};

export type QuotaDecision =
  | { readonly kind: "accept"; readonly used: number; readonly limit: number | null }
  | {
      readonly kind: "overage";
      readonly used: number;
      readonly limit: number;
      /** Where in the grace band this sits, 1.0 to OVERAGE_MULTIPLE. */
      readonly ratio: number;
    }
  | { readonly kind: "reject"; readonly used: number; readonly limit: number; readonly ratio: number };

export const Quota = {
  /**
   * Decide, purely. No clock, no database, no notion of who is asking.
   */
  decide: (entitlement: Entitlement, period: UsagePeriod): QuotaDecision => {
    const limit = entitlement.limits.eventsPerMonth;
    if (limit === null) return { kind: "accept", used: period.used, limit: null };

    if (period.used < limit) return { kind: "accept", used: period.used, limit };

    const ratio = limit === 0 ? Number.POSITIVE_INFINITY : period.used / limit;
    if (ratio < OVERAGE_MULTIPLE) {
      return { kind: "overage", used: period.used, limit, ratio };
    }
    return { kind: "reject", used: period.used, limit, ratio };
  },

  /** Whether events are still being stored. Overage counts as accepted. */
  accepts: (d: QuotaDecision): boolean => d.kind !== "reject",

  /** Whether the customer should be told something is wrong. */
  needsAttention: (d: QuotaDecision): boolean => d.kind !== "accept",

  /** Fraction of the allowance consumed, or null when unlimited. */
  utilisation: (d: QuotaDecision): number | null => {
    switch (d.kind) {
      case "accept":
        return d.limit === null || d.limit === 0 ? null : d.used / d.limit;
      case "overage":
      case "reject":
        return d.ratio;
      default:
        return assertNever(d);
    }
  },
} as const;
