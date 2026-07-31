/**
 * A workspace's paid standing, and how a payment event changes it.
 *
 * The mapping is a pure function. That matters more here than almost anywhere
 * else in the system: billing is the code path nobody exercises by accident,
 * the one where a mistake is invisible until a customer complains, and the one
 * where you cannot reproduce the input on demand. Making it a function from
 * (state, event) to state means every transition is a test rather than a
 * Stripe account and a card.
 *
 * The bug this replaces: v1 handled `checkout.session.completed` with an
 * `UPDATE subscriptions SET … WHERE user_id = $1`. When no row existed — which
 * is the case for **every first-time subscriber** — the statement matched zero
 * rows, reported success, and the customer paid for nothing. It was a silent
 * upgrade-to-nothing, and the only signal was the absence of one.
 *
 * Here a transition always produces a subscription. There is no update-shaped
 * operation that can match nothing.
 */

import { assertNever } from "../shared/brand";
import type { Instant } from "../shared/instant";
import type { WorkspaceId } from "../shared/ids";
import { Entitlement, type PaymentState } from "./entitlement";
import { PLAN_IDS, type PlanId } from "./plan";

/** Stripe's ids, kept opaque. The domain never parses or constructs one. */
export type CustomerRef = string;
export type SubscriptionRef = string;

export type Subscription = {
  readonly workspace: WorkspaceId;
  readonly plan: PlanId;
  readonly payment: PaymentState;
  /** Null until the workspace has ever been to checkout. */
  readonly customer: CustomerRef | null;
  readonly subscription: SubscriptionRef | null;
  /** When the paid period lapses. Null when there is no paid period. */
  readonly renewsAt: Instant | null;
  readonly updatedAt: Instant;
};

export const Subscription = {
  /** What every workspace starts as. Free, unpaid, and entitled to the free plan. */
  none: (workspace: WorkspaceId, at: Instant): Subscription => ({
    workspace,
    plan: "free",
    payment: "none",
    customer: null,
    subscription: null,
    renewsAt: null,
    updatedAt: at,
  }),

  entitlementOf: (s: Subscription): Entitlement => Entitlement.resolve(s.plan, s.payment),

  isPaid: (s: Subscription): boolean => Entitlement.isPaid(Subscription.entitlementOf(s)),
} as const;

/**
 * What a payment provider told us, in our own vocabulary.
 *
 * Deliberately not Stripe's event names. The adapter translates; the domain
 * reasons about five things that can happen to a subscription. A sixth kind of
 * Stripe event is the adapter's problem, and an unrecognised one is ignored
 * rather than guessed at.
 */
export type BillingEvent =
  | {
      readonly kind: "checkout_completed";
      readonly plan: PlanId;
      readonly customer: CustomerRef;
      readonly subscription: SubscriptionRef;
      readonly renewsAt: Instant | null;
    }
  | {
      readonly kind: "subscription_updated";
      readonly plan: PlanId;
      readonly subscription: SubscriptionRef;
      readonly renewsAt: Instant | null;
      /** Stripe's status, already narrowed by the adapter. */
      readonly active: boolean;
    }
  | { readonly kind: "payment_failed"; readonly subscription: SubscriptionRef }
  | { readonly kind: "payment_recovered"; readonly subscription: SubscriptionRef }
  | { readonly kind: "subscription_canceled"; readonly subscription: SubscriptionRef };

export type Transition = {
  readonly subscription: Subscription;
  /** True when the entitlement changed, so the caller knows to invalidate. */
  readonly entitlementChanged: boolean;
  /** For the outbox: worth telling the customer about. */
  readonly notable: "upgraded" | "downgraded" | "payment_failed" | "recovered" | null;
};

const sameEntitlement = (a: Entitlement, b: Entitlement): boolean =>
  a.plan === b.plan && a.inGrace === b.inGrace;

/**
 * Apply an event. Always returns a subscription — never "no rows matched".
 *
 * `at` is the server's clock, passed in. Note what is *not* here: no decision
 * about what a plan entitles you to. That is `PlanCatalog`'s, and keeping the
 * two apart is why v1's three rival "is this customer on Pro?" checks cannot
 * recur.
 */
export const applyBillingEvent = (current: Subscription, event: BillingEvent, at: Instant): Transition => {
  const before = Subscription.entitlementOf(current);

  const next = ((): Subscription => {
    switch (event.kind) {
      case "checkout_completed":
        // The first-time case. An upsert, not an update: this is exactly where
        // v1 matched zero rows and told the customer nothing was wrong.
        return {
          ...current,
          plan: event.plan,
          payment: "active",
          customer: event.customer,
          subscription: event.subscription,
          renewsAt: event.renewsAt,
          updatedAt: at,
        };

      case "subscription_updated":
        return {
          ...current,
          plan: event.plan,
          // An inactive subscription that is not explicitly failed or canceled
          // is treated as canceled: the safe reading of "not active" is that
          // the customer is not paying.
          payment: event.active ? "active" : "canceled",
          subscription: event.subscription,
          renewsAt: event.renewsAt,
          updatedAt: at,
        };

      case "payment_failed":
        // The plan is kept. Dropping a paying customer to free the instant a
        // card expires is a worse failure than carrying them for a cycle —
        // `Entitlement.resolve` marks this `inGrace` so the UI can say so.
        return { ...current, payment: "past_due", updatedAt: at };

      case "payment_recovered":
        return { ...current, payment: "active", updatedAt: at };

      case "subscription_canceled":
        // Entitlement falls back to free; the plan id is kept for history, and
        // `Entitlement.resolve` is what decides they no longer get it.
        return { ...current, payment: "canceled", renewsAt: null, updatedAt: at };

      default:
        return assertNever(event);
    }
  })();

  const after = Subscription.entitlementOf(next);
  return {
    subscription: next,
    entitlementChanged: !sameEntitlement(before, after),
    notable: notabilityOf(event, before, after),
  };
};

const notabilityOf = (
  event: BillingEvent,
  before: Entitlement,
  after: Entitlement,
): Transition["notable"] => {
  if (event.kind === "payment_failed") return "payment_failed";
  if (event.kind === "payment_recovered" && before.inGrace) return "recovered";
  if (Entitlement.isPaid(after) && !Entitlement.isPaid(before)) return "upgraded";
  if (Entitlement.isPaid(before) && !Entitlement.isPaid(after)) return "downgraded";
  return null;
};

export const isPlanId = (raw: string): raw is PlanId => (PLAN_IDS as readonly string[]).includes(raw);
