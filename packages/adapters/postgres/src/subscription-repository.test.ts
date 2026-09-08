/**
 * The billing side of storage, and the incident it is written against.
 *
 * v1 handled `checkout.session.completed` with
 * `UPDATE subscriptions SET … WHERE user_id = $1`. For every first-time
 * subscriber no row existed, the statement matched zero rows, and the handler
 * reported success. The customer paid and got nothing, and the only signal was
 * the absence of one.
 */

import { afterAll, beforeEach, expect, test } from "bun:test";
import { WorkspaceId } from "@counted/kernel";
import { Subscription, applyBillingEvent } from "@counted/tenancy-domain";
import { T0, at, givenWorkspace, liveHarness, type Harness } from "./fixtures";
import { closeDatabase, describeLive } from "./testing";

describeLive("PostgresSubscriptionRepository", () => {
  let h: Harness;
  let workspace: WorkspaceId;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
    workspace = await givenWorkspace(h.repositories);
  });
  afterAll(closeDatabase);

  test("a first-time subscriber's save creates the row it needed to update", async () => {
    expect(await h.repositories.subscriptions.find(workspace)).toBeNull();

    const { subscription } = applyBillingEvent(
      Subscription.none(workspace, T0),
      {
        kind: "checkout_completed",
        plan: "pro",
        customer: "cus_1",
        subscription: "sub_1",
        renewsAt: at(60),
      },
      at(1),
    );
    await h.repositories.subscriptions.save(subscription);

    const found = await h.repositories.subscriptions.find(workspace);
    expect(found?.plan).toBe("pro");
    expect(found?.payment).toBe("active");
    expect(found?.customer).toBe("cus_1");
    expect(found?.renewsAt).toEqual(at(60));
    expect(found?.updatedAt).toEqual(at(1));
  });

  test("saving again updates in place rather than duplicating the workspace", async () => {
    const first = applyBillingEvent(
      Subscription.none(workspace, T0),
      { kind: "checkout_completed", plan: "pro", customer: "cus_1", subscription: "sub_1", renewsAt: null },
      at(1),
    ).subscription;
    await h.repositories.subscriptions.save(first);

    const failed = applyBillingEvent(first, { kind: "payment_failed", subscription: "sub_1" }, at(2))
      .subscription;
    await h.repositories.subscriptions.save(failed);

    expect((await h.pool.query(`SELECT 1 FROM subscriptions`)).rowCount).toBe(1);
    expect((await h.repositories.subscriptions.find(workspace))?.payment).toBe("past_due");
  });

  test("a webhook can find the workspace from the provider's own ids", async () => {
    // A webhook knows `cus_…` and `sub_…`, not which workspace that is. Both
    // columns are unique, so neither lookup can quietly pick one of two.
    const subscription = applyBillingEvent(
      Subscription.none(workspace, T0),
      { kind: "checkout_completed", plan: "pro", customer: "cus_1", subscription: "sub_1", renewsAt: null },
      at(1),
    ).subscription;
    await h.repositories.subscriptions.save(subscription);

    expect((await h.repositories.subscriptions.findByCustomer("cus_1"))?.workspace).toBe(workspace);
    expect((await h.repositories.subscriptions.findBySubscriptionRef("sub_1"))?.workspace).toBe(
      workspace,
    );
    expect(await h.repositories.subscriptions.findByCustomer("cus_unknown")).toBeNull();
  });

  test("two workspaces cannot share one provider customer", async () => {
    const other = await givenWorkspace(h.repositories, "ws_2", "Other");
    await h.repositories.subscriptions.save({
      ...Subscription.none(workspace, T0),
      customer: "cus_1",
    });
    expect(
      h.repositories.subscriptions.save({ ...Subscription.none(other, T0), customer: "cus_1" }),
    ).rejects.toThrow(/subscriptions_customer_ref_key/);
  });
});

describeLive("PostgresWebhookLedger", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await liveHarness();
    await h.reset();
  });
  afterAll(closeDatabase);

  test("the first delivery claims the event and every redelivery does not", async () => {
    expect(await h.repositories.webhooks.claim("evt_1", "checkout.completed", T0)).toBe(true);
    expect(await h.repositories.webhooks.claim("evt_1", "checkout.completed", at(1))).toBe(false);
  });

  test("two deliveries racing produce exactly one claim", async () => {
    // Redelivery is bursty: the retry usually arrives while the first attempt is
    // still running, which is exactly when a check-then-insert is open.
    const verdicts = await Promise.all([
      h.repositories.webhooks.claim("evt_race", "invoice.paid", T0),
      h.repositories.webhooks.claim("evt_race", "invoice.paid", T0),
      h.repositories.webhooks.claim("evt_race", "invoice.paid", T0),
    ]);
    expect(verdicts.filter(Boolean)).toHaveLength(1);
  });

  test("marking processed is recorded and does not un-claim the event", async () => {
    await h.repositories.webhooks.claim("evt_1", "checkout.completed", T0);
    await h.repositories.webhooks.markProcessed("evt_1", at(1));

    const { rows } = await h.pool.query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM webhook_receipts WHERE id = 'evt_1'`,
    );
    expect(rows[0]?.processed_at).not.toBeNull();
    expect(await h.repositories.webhooks.claim("evt_1", "checkout.completed", at(2))).toBe(false);
  });
});
