import { describe, expect, test } from "bun:test";
import {
  Entitlement,
  Instant,
  PlanCatalog,
  Subscription,
  WorkspaceId,
  applyBillingEvent,
  isPlanId,
  type BillingEvent,
} from "../index";

const WS = WorkspaceId("ws_1");
const t0 = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const t1 = Instant.fromEpochMillis(Date.parse("2026-03-18T15:00:00.000Z"));
const renews = Instant.fromEpochMillis(Date.parse("2026-04-17T15:00:00.000Z"));

const fresh = () => Subscription.none(WS, t0);

const checkout: BillingEvent = {
  kind: "checkout_completed",
  plan: "pro",
  customer: "cus_1",
  subscription: "sub_1",
  renewsAt: renews,
};

describe("a first-time subscriber is never lost", () => {
  test("checkout on a workspace with no prior record produces a paid subscription", () => {
    // The bug this replaces: v1 ran `UPDATE subscriptions … WHERE user_id`,
    // which matched zero rows for every first-time subscriber, reported
    // success, and left a paying customer on the free plan.
    const { subscription } = applyBillingEvent(fresh(), checkout, t1);
    expect(subscription).toMatchObject({
      plan: "pro",
      payment: "active",
      customer: "cus_1",
      subscription: "sub_1",
    });
    expect(Subscription.isPaid(subscription)).toBe(true);
  });

  test("the transition always yields a subscription, for every event", () => {
    // There is no update-shaped operation that can match nothing.
    const events: readonly BillingEvent[] = [
      checkout,
      { kind: "subscription_updated", plan: "pro", subscription: "sub_1", renewsAt: renews, active: true },
      { kind: "payment_failed", subscription: "sub_1" },
      { kind: "payment_recovered", subscription: "sub_1" },
      { kind: "subscription_canceled", subscription: "sub_1" },
    ];
    for (const event of events) {
      expect(applyBillingEvent(fresh(), event, t1).subscription.workspace).toBe(WS);
    }
  });

  test("checkout reports the entitlement changed, so caches can be dropped", () => {
    expect(applyBillingEvent(fresh(), checkout, t1).entitlementChanged).toBe(true);
    expect(applyBillingEvent(fresh(), checkout, t1).notable).toBe("upgraded");
  });
});

describe("a payment problem does not drop a customer to free", () => {
  const paid = () => applyBillingEvent(fresh(), checkout, t1).subscription;

  test("past_due keeps the plan and flags the grace", () => {
    // Dropping a paying customer the instant a card expires is a worse failure
    // than carrying them for a cycle — but doing it silently and
    // inconsistently, which is what v1 did, is worse than either.
    const { subscription } = applyBillingEvent(paid(), { kind: "payment_failed", subscription: "sub_1" }, t1);
    const entitlement = Subscription.entitlementOf(subscription);
    expect(subscription.payment).toBe("past_due");
    expect(entitlement.plan).toBe("pro");
    expect(entitlement.inGrace).toBe(true);
  });

  test("the entitlement changed, because in-grace is a different state", () => {
    const transition = applyBillingEvent(paid(), { kind: "payment_failed", subscription: "sub_1" }, t1);
    expect(transition.entitlementChanged).toBe(true);
    expect(transition.notable).toBe("payment_failed");
  });

  test("recovering clears the grace and says so", () => {
    const struggling = applyBillingEvent(paid(), { kind: "payment_failed", subscription: "sub_1" }, t1).subscription;
    const transition = applyBillingEvent(struggling, { kind: "payment_recovered", subscription: "sub_1" }, t1);
    expect(Subscription.entitlementOf(transition.subscription).inGrace).toBe(false);
    expect(transition.notable).toBe("recovered");
  });

  test("recovering something that was never failing is not notable", () => {
    expect(applyBillingEvent(paid(), { kind: "payment_recovered", subscription: "sub_1" }, t1).notable).toBeNull();
  });
});

describe("cancellation", () => {
  const paid = () => applyBillingEvent(fresh(), checkout, t1).subscription;

  test("entitlement falls back to free, and the plan id is kept for history", () => {
    const { subscription } = applyBillingEvent(paid(), { kind: "subscription_canceled", subscription: "sub_1" }, t1);
    expect(subscription.payment).toBe("canceled");
    // The stored plan is still `pro`; what decides is `Entitlement.resolve`.
    expect(subscription.plan).toBe("pro");
    expect(Subscription.entitlementOf(subscription).plan).toBe("free");
    expect(Subscription.isPaid(subscription)).toBe(false);
  });

  test("it is reported as a downgrade, and clears the renewal date", () => {
    const transition = applyBillingEvent(paid(), { kind: "subscription_canceled", subscription: "sub_1" }, t1);
    expect(transition.notable).toBe("downgraded");
    expect(transition.subscription.renewsAt).toBeNull();
  });

  test("an inactive update is treated as canceled, not as still paying", () => {
    // The safe reading of "not active" is that the customer is not paying.
    const { subscription } = applyBillingEvent(
      paid(),
      { kind: "subscription_updated", plan: "pro", subscription: "sub_1", renewsAt: null, active: false },
      t1,
    );
    expect(Subscription.isPaid(subscription)).toBe(false);
  });
});

describe("the same event twice changes nothing the second time", () => {
  test("applying checkout twice is idempotent in its effect", () => {
    // The ledger stops a replay reaching here at all, but the transition being
    // idempotent means a gap in that ledger is not a billing incident.
    const once = applyBillingEvent(fresh(), checkout, t1).subscription;
    const twice = applyBillingEvent(once, checkout, t1).subscription;
    expect(twice).toEqual(once);
  });

  test("the second application reports no entitlement change", () => {
    const once = applyBillingEvent(fresh(), checkout, t1).subscription;
    expect(applyBillingEvent(once, checkout, t1).entitlementChanged).toBe(false);
  });
});

describe("the domain owns the catalog, not the provider", () => {
  test("nothing here decides what a plan allows", () => {
    // v1 kept its plan catalog inside `lib/stripe.ts`, which is how "is this
    // customer on Pro?" ended up with three different answers in three files.
    const { subscription } = applyBillingEvent(fresh(), checkout, t1);
    expect(Subscription.entitlementOf(subscription).limits).toEqual(PlanCatalog.limitsFor("pro"));
  });

  test("a free subscription is entitled to exactly the free plan", () => {
    expect(Subscription.entitlementOf(fresh())).toEqual(Entitlement.none());
  });

  test("an unrecognised plan string is not a plan", () => {
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("enterprise-plus")).toBe(false);
  });
});
