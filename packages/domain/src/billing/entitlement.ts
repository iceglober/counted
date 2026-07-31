/**
 * Entitlement — what a workspace is currently allowed to do.
 *
 * There is exactly one function that answers "is this customer on Pro?", and
 * every caller uses it. v1 answered it three different ways:
 *
 *   - `usage.ts` required `plan === "pro" && status === "active"`
 *   - `projects/route.ts` read `sub?.plan` alone, ignoring status
 *   - `billing/status/route.ts` returned raw plan and status and let the
 *     client decide
 *
 * So a past-due customer kept unlimited projects while being metered as free.
 * Not a bug in any one file — a bug in having three definitions.
 *
 * The payment vendor reports a `PaymentState` and nothing more. Turning that
 * into permission is the domain's job.
 */

import { assertNever } from "../shared/brand";
import { PlanCatalog, type PlanId, type PlanLimits } from "./plan";
import { WorkspaceLimits } from "../workspace/workspace";

/** What the payment provider says about the subscription. */
export type PaymentState = "none" | "active" | "past_due" | "canceled";

export type Entitlement = {
  readonly plan: PlanId;
  readonly limits: PlanLimits;
  /**
   * True when the paid plan is being honoured despite a payment problem. The
   * customer keeps working; the UI can say something; nothing is silently
   * different.
   */
  readonly inGrace: boolean;
};

export const Entitlement = {
  /**
   * The single definition.
   *
   * A `past_due` subscription keeps its plan and is flagged `inGrace`.
   * Dropping a paying customer to free the instant a card expires is a worse
   * failure than carrying them for a cycle — but doing it *silently and
   * inconsistently*, which is what v1 did, is worse than either.
   */
  resolve: (plan: PlanId, payment: PaymentState): Entitlement => {
    switch (payment) {
      case "active":
        return { plan, limits: PlanCatalog.limitsFor(plan), inGrace: false };
      case "past_due":
        return { plan, limits: PlanCatalog.limitsFor(plan), inGrace: true };
      case "none":
      case "canceled":
        return { plan: "free", limits: PlanCatalog.limitsFor("free"), inGrace: false };
      default:
        return assertNever(payment);
    }
  },

  /** The free entitlement, for a workspace with no subscription at all. */
  none: (): Entitlement => Entitlement.resolve("free", "none"),

  isPaid: (e: Entitlement): boolean => e.plan !== "free",

  /** Project into the shape the Workspace aggregate enforces. */
  toWorkspaceLimits: (e: Entitlement): WorkspaceLimits =>
    WorkspaceLimits.of(e.limits.projects, e.limits.seats),

  /** True when moving to `next` would take something away. */
  isDowngrade: (current: Entitlement, next: Entitlement): boolean =>
    !PlanCatalog.isAtLeast(next.plan, current.plan),
} as const;
