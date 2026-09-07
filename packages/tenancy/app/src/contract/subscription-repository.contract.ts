/**
 * What any SubscriptionRepository must do.
 *
 * The port exists because of one v1 incident, and so does most of this suite.
 * `checkout.session.completed` was handled with
 * `UPDATE subscriptions SET … WHERE user_id = $1`. For every first-time
 * subscriber no row existed, the statement matched nothing, and the handler
 * reported success — the customer paid and got nothing, and the only signal was
 * the absence of one. So `save` is an upsert, there is no update-shaped sibling
 * to reach for, and the first assertion below is that a save into an empty
 * table produces a row.
 *
 * The three finders are the three ways a webhook arrives. Stripe knows
 * `cus_…` and `sub_…`; it does not know what a workspace is. A repository that
 * answered one of them and not the others would strand every renewal.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { Instant, type WorkspaceId } from "@counted/kernel";
import { PAYMENT_STATES, PLAN_IDS, Subscription } from "@counted/tenancy-domain";
import type { SubscriptionRepository } from "../ports";

export type SubscriptionRepositoryHarness = {
  readonly subscriptions: SubscriptionRepository;
  /**
   * A workspace this repository will accept a subscription for.
   *
   * Postgres has a foreign key from `subscriptions.workspace_id`; the fake has
   * nothing. Asking the harness means the suite never has to know which.
   */
  givenWorkspace(): Promise<WorkspaceId>;
  unknownWorkspace(): WorkspaceId;
  teardown?(): Promise<void>;
};

export const subscriptionRepositoryContract = (
  label: string,
  create: () => Promise<SubscriptionRepositoryHarness> | SubscriptionRepositoryHarness,
  at: Instant,
): void => {
  describe(`SubscriptionRepository contract: ${label}`, () => {
    let h!: SubscriptionRepositoryHarness;
    let workspace!: WorkspaceId;

    beforeEach(async () => {
      h = await create();
      workspace = await h.givenWorkspace();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    const paid = (overrides: Partial<Subscription> = {}): Subscription => ({
      ...Subscription.none(workspace, at),
      plan: "pro",
      payment: "active",
      customer: `cus_${String(workspace)}`,
      subscription: `sub_${String(workspace)}`,
      renewsAt: Instant.fromEpochMillis(Instant.toEpochMillis(at) + 30 * 86_400_000),
      updatedAt: at,
      ...overrides,
    });

    test("find answers null for a workspace with no subscription", async () => {
      expect(await h.subscriptions.find(workspace)).toBeNull();
      expect(await h.subscriptions.find(h.unknownWorkspace())).toBeNull();
    });

    test("a first-time subscriber's save creates the row it would have had to update", async () => {
      const first = paid();
      await h.subscriptions.save(first);

      const found = await h.subscriptions.find(workspace);
      expect(found).not.toBeNull();
      expect(found?.plan).toBe("pro");
      expect(found?.payment).toBe("active");
      expect(found?.customer).toBe(first.customer);
      expect(found?.subscription).toBe(first.subscription);
    });

    test("saving again updates in place rather than producing a second subscription", async () => {
      await h.subscriptions.save(paid());
      await h.subscriptions.save(paid({ payment: "past_due" }));

      expect((await h.subscriptions.find(workspace))?.payment).toBe("past_due");
      // Two rows would show up here as the wrong one being picked at random,
      // which is exactly the failure a unique key on workspace_id prevents.
      expect((await h.subscriptions.findByCustomer(`cus_${String(workspace)}`))?.payment).toBe(
        "past_due",
      );
    });

    test("a webhook can find the subscription by the provider's customer id", async () => {
      const subscription = paid();
      await h.subscriptions.save(subscription);
      expect((await h.subscriptions.findByCustomer(subscription.customer ?? ""))?.workspace).toBe(
        workspace,
      );
    });

    test("a webhook can find the subscription by the provider's subscription id", async () => {
      const subscription = paid();
      await h.subscriptions.save(subscription);
      expect(
        (await h.subscriptions.findBySubscriptionRef(subscription.subscription ?? ""))?.workspace,
      ).toBe(workspace);
    });

    test("the finders answer null for provider ids nothing here matches", async () => {
      await h.subscriptions.save(paid());
      expect(await h.subscriptions.findByCustomer("cus_nobody")).toBeNull();
      expect(await h.subscriptions.findBySubscriptionRef("sub_nobody")).toBeNull();
    });

    test("a workspace that has never checked out has null provider ids and no billing account", async () => {
      await h.subscriptions.save(Subscription.none(workspace, at));
      const found = await h.subscriptions.find(workspace);
      expect(found?.customer).toBeNull();
      expect(found?.subscription).toBeNull();
      expect(found?.renewsAt).toBeNull();
      expect(found === null ? null : Subscription.hasBillingAccount(found)).toBe(false);
    });

    test("one provider customer belongs to exactly one workspace", async () => {
      // Not a nicety. `findByCustomer` is how a webhook decides whose plan to
      // change, and two rows sharing a `cus_…` makes that a coin flip — the
      // upgrade lands on someone else's workspace and nothing reports it.
      const other = await h.givenWorkspace();
      await h.subscriptions.save(paid());
      await expect(
        h.subscriptions.save(paid({ workspace: other, subscription: "sub_other" })),
      ).rejects.toThrow();
    });

    test("one provider subscription belongs to exactly one workspace", async () => {
      const other = await h.givenWorkspace();
      await h.subscriptions.save(paid());
      await expect(
        h.subscriptions.save(paid({ workspace: other, customer: "cus_other" })),
      ).rejects.toThrow();
    });

    for (const plan of PLAN_IDS) {
      for (const payment of PAYMENT_STATES) {
        test(`a ${plan}/${payment} subscription survives the round trip exactly`, async () => {
          // Every combination, because the two columns are decoded separately
          // and a decoder that silently defaulted one of them would answer the
          // entitlement question wrongly for exactly the states nobody tests.
          const subscription = paid({ plan, payment });
          await h.subscriptions.save(subscription);
          const found = await h.subscriptions.find(workspace);
          expect(found?.plan).toBe(plan);
          expect(found?.payment).toBe(payment);
        });
      }
    }

    test("renewsAt round trips as an instant, and null stays null", async () => {
      const renewal = Instant.fromEpochMillis(Instant.toEpochMillis(at) + 86_400_000);
      await h.subscriptions.save(paid({ renewsAt: renewal }));
      expect((await h.subscriptions.find(workspace))?.renewsAt).toBe(renewal);

      await h.subscriptions.save(paid({ renewsAt: null }));
      expect((await h.subscriptions.find(workspace))?.renewsAt).toBeNull();
    });

    test("the entitlement is derived from what came back, not stored beside it", async () => {
      await h.subscriptions.save(paid({ plan: "pro", payment: "past_due" }));
      const found = await h.subscriptions.find(workspace);
      if (found === null) throw new Error("expected a subscription");
      const entitlement = Subscription.entitlementOf(found);
      expect(entitlement.plan).toBe("pro");
      expect(entitlement.inGrace).toBe(true);
      expect(entitlement.limits.eventsPerMonth).toBe(1_000_000);
    });

    test("one workspace's subscription is never another's", async () => {
      const other = await h.givenWorkspace();
      await h.subscriptions.save(paid());
      expect(await h.subscriptions.find(other)).toBeNull();
    });
  });
};
