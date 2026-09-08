import { describe, expect, test } from "bun:test";
import { Instant, WorkspaceId } from "@counted/kernel";
import { Subscription, applyBillingEvent, type BillingEvent } from "./subscription";

const ws = WorkspaceId("ws_1");
const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const t1 = Instant.fromEpochMillis(1_700_000_060_000);
const renewsAt = Instant.fromEpochMillis(1_702_600_000_000);

const checkout: BillingEvent = {
  kind: "checkout_completed",
  plan: "pro",
  customer: "cus_1",
  subscription: "sub_1",
  renewsAt,
};

describe("a first-time subscriber", () => {
  /**
   * v1's handler was `UPDATE subscriptions SET … WHERE user_id = $1`, which
   * matched zero rows for every first-time subscriber, reported success, and
   * left the customer paying for nothing.
   */
  test("checkout produces a paid subscription from nothing", () => {
    const transition = applyBillingEvent(Subscription.none(ws, t0), checkout, t1);
    expect(transition.subscription).toEqual({
      workspace: ws,
      plan: "pro",
      payment: "active",
      customer: "cus_1",
      subscription: "sub_1",
      renewsAt,
      updatedAt: t1,
    });
    expect(transition.entitlementChanged).toBe(true);
    expect(transition.notable).toBe("upgraded");
  });
});

describe("what each event does to the standing", () => {
  const paid = applyBillingEvent(Subscription.none(ws, t0), checkout, t0).subscription;

  test("a failed payment keeps the plan and enters grace", () => {
    const t = applyBillingEvent(paid, { kind: "payment_failed", subscription: "sub_1" }, t1);
    expect(t.subscription.plan).toBe("pro");
    expect(t.subscription.payment).toBe("past_due");
    expect(Subscription.entitlementOf(t.subscription).inGrace).toBe(true);
    expect(Subscription.entitlementOf(t.subscription).limits.projects).toBeNull();
    expect(t.notable).toBe("payment_failed");
  });

  test("recovery is only news if they were in grace", () => {
    const failed = applyBillingEvent(paid, { kind: "payment_failed", subscription: "sub_1" }, t1);
    const recovered = applyBillingEvent(
      failed.subscription,
      { kind: "payment_recovered", subscription: "sub_1" },
      t1,
    );
    expect(recovered.subscription.payment).toBe("active");
    expect(recovered.notable).toBe("recovered");

    const noop = applyBillingEvent(paid, { kind: "payment_recovered", subscription: "sub_1" }, t1);
    expect(noop.notable).toBeNull();
  });

  test("cancellation keeps the plan id for history and drops the entitlement to free", () => {
    const t = applyBillingEvent(paid, { kind: "subscription_canceled", subscription: "sub_1" }, t1);
    expect(t.subscription.plan).toBe("pro");
    expect(Subscription.entitlementOf(t.subscription).plan).toBe("free");
    expect(t.subscription.renewsAt).toBeNull();
    expect(t.notable).toBe("downgraded");
  });

  test("an update that is not active is read as canceled — the safe reading of 'not paying'", () => {
    const t = applyBillingEvent(
      paid,
      { kind: "subscription_updated", plan: "pro", subscription: "sub_1", renewsAt: null, active: false },
      t1,
    );
    expect(t.subscription.payment).toBe("canceled");
    expect(Subscription.entitlementOf(t.subscription).plan).toBe("free");
  });
});

describe("replaying the same event", () => {
  test("changes nothing but the timestamp, so at-least-once delivery is survivable", () => {
    const once = applyBillingEvent(Subscription.none(ws, t0), checkout, t1);
    const twice = applyBillingEvent(once.subscription, checkout, t1);
    expect(twice.subscription).toEqual(once.subscription);
    expect(twice.entitlementChanged).toBe(false);
    expect(twice.notable).toBeNull();
  });
});

describe("projecting into the aggregate", () => {
  test("standingOf carries both facts, so payment cannot be dropped on the way", () => {
    const canceled = applyBillingEvent(
      applyBillingEvent(Subscription.none(ws, t0), checkout, t0).subscription,
      { kind: "subscription_canceled", subscription: "sub_1" },
      t1,
    ).subscription;
    expect(Subscription.standingOf(canceled)).toEqual({ plan: "pro", payment: "canceled" });
  });

  test("a workspace that has never checked out has no billing account", () => {
    expect(Subscription.hasBillingAccount(Subscription.none(ws, t0))).toBe(false);
    expect(Subscription.isPaid(Subscription.none(ws, t0))).toBe(false);
  });
});
