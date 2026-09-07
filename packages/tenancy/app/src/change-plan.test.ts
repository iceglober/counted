import { describe, expect, test } from "bun:test";
import { Instant, WorkspaceId, isErr, isOk } from "@counted/kernel";
import { Subscription } from "@counted/tenancy-domain";
import { changePlan } from "./change-plan";
import { fakeBilling, fakeSubscriptions } from "./testing";

const at = Instant.fromEpochMillis(1_700_000_000_000);
const ws = WorkspaceId("ws_1");

const command = {
  workspace: ws,
  plan: "pro",
  cadence: "monthly" as const,
  successUrl: "https://app.example/billing?ok",
  cancelUrl: "https://app.example/billing",
  returnUrl: "https://app.example/settings/billing",
};

const paid = (): Subscription => ({
  workspace: ws,
  plan: "pro",
  payment: "active",
  customer: "cus_1",
  subscription: "sub_1",
  renewsAt: null,
  updatedAt: at,
});

describe("what kind of session the customer gets", () => {
  test("a free workspace upgrading goes to checkout", async () => {
    const billing = fakeBilling();
    const subscriptions = fakeSubscriptions(Subscription.none(ws, at));

    const result = await changePlan({ subscriptions, billing }, command);

    expect(isOk(result)).toBe(true);
    expect(billing.checkouts).toHaveLength(1);
    expect(billing.checkouts[0]).toMatchObject({ plan: "pro", cadence: "monthly", customer: null });
    expect(billing.portals).toHaveLength(0);
  });

  test("an existing subscriber asking for the plan they hold goes to the portal", async () => {
    // Sending them to checkout again creates a second subscription and charges
    // them twice. The portal is where a subscription is changed.
    const billing = fakeBilling();
    const result = await changePlan(
      { subscriptions: fakeSubscriptions(paid()), billing },
      command,
    );

    expect(isOk(result)).toBe(true);
    expect(billing.checkouts).toHaveLength(0);
    expect(billing.portals).toEqual([
      { customer: "cus_1", returnUrl: "https://app.example/settings/billing" },
    ]);
  });

  test("downgrading to free goes to the portal, not to checkout", async () => {
    const billing = fakeBilling();
    const result = await changePlan(
      { subscriptions: fakeSubscriptions(paid()), billing },
      { ...command, plan: "free" },
    );

    expect(isOk(result)).toBe(true);
    expect(billing.checkouts).toHaveLength(0);
    expect(billing.portals).toHaveLength(1);
  });

  test("a past-due subscriber is still entitled to pro, so they manage rather than re-buy", async () => {
    const billing = fakeBilling();
    await changePlan(
      { subscriptions: fakeSubscriptions({ ...paid(), payment: "past_due" }), billing },
      command,
    );
    expect(billing.portals).toHaveLength(1);
  });

  test("a canceled subscriber is back on free, so pro is a fresh checkout", async () => {
    const billing = fakeBilling();
    await changePlan(
      { subscriptions: fakeSubscriptions({ ...paid(), payment: "canceled" }), billing },
      command,
    );
    expect(billing.checkouts).toHaveLength(1);
    // Their existing customer id travels, so they are not duplicated at the provider.
    expect(billing.checkouts[0]?.customer).toBe("cus_1");
  });
});

describe("what is refused before the provider is called", () => {
  test("an unknown plan id", async () => {
    const billing = fakeBilling();
    const result = await changePlan(
      { subscriptions: fakeSubscriptions(Subscription.none(ws, at)), billing },
      { ...command, plan: "enterprise" },
    );

    if (!isErr(result)) throw new Error("an unknown plan should be refused");
    expect(result.error).toEqual({ kind: "PlanUnavailable", plan: "enterprise" });
    expect(billing.checkouts).toHaveLength(0);
  });

  test("a workspace with no subscription row at all", async () => {
    const result = await changePlan(
      { subscriptions: fakeSubscriptions(), billing: fakeBilling() },
      command,
    );
    if (!isErr(result)) throw new Error("a missing subscription should be refused");
    expect(result.error).toEqual({ kind: "NoSubscription", workspace: ws });
  });

  test("cancelling when there is no provider customer to cancel", async () => {
    const result = await changePlan(
      { subscriptions: fakeSubscriptions(Subscription.none(ws, at)), billing: fakeBilling() },
      { ...command, plan: "free" },
    );
    if (!isErr(result)) throw new Error("there is nothing to manage");
    expect(result.error).toEqual({ kind: "NoSubscription", workspace: ws });
  });
});

describe("when the provider is down", () => {
  test("a rejection becomes a domain outcome, not an unhandled throw", async () => {
    const billing = fakeBilling({ failWith: new Error("connect ETIMEDOUT") });
    const result = await changePlan(
      { subscriptions: fakeSubscriptions(Subscription.none(ws, at)), billing },
      command,
    );

    if (!isErr(result)) throw new Error("a provider failure should be reported");
    expect(result.error).toEqual({ kind: "ProviderUnavailable", detail: "connect ETIMEDOUT" });
  });
});
