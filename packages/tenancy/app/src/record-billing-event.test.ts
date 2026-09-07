import { describe, expect, test } from "bun:test";
import { AccountId, Instant, ProjectId, WorkspaceId, err, isErr, isOk, ok } from "@counted/kernel";
import { Subscription, Workspace, type BillingEvent } from "@counted/tenancy-domain";
import type { Membership } from "@counted/identity-ports";
import type { VerifiedWebhook, WebhookRejection } from "@counted/tenancy-ports";
import { fromWebhookRejection, recordBillingEvent } from "./record-billing-event";
import { fakeBilling, fakeLedger, fakeMemberships, fakeSubscriptions, fakeWorkspaces } from "./testing";

const at = Instant.fromEpochMillis(1_700_000_000_000);
const ws = WorkspaceId("ws_1");
const founder = AccountId("acct_1");

const checkout: BillingEvent = {
  kind: "checkout_completed",
  plan: "pro",
  customer: "cus_1",
  subscription: "sub_1",
  renewsAt: null,
};

const verified = (
  event: BillingEvent | null,
  patch: Partial<VerifiedWebhook<BillingEvent>> = {},
): VerifiedWebhook<BillingEvent> => ({
  id: "evt_1",
  type: "checkout.session.completed",
  workspace: ws,
  event,
  ...patch,
});

const billingThat = (webhook: VerifiedWebhook<BillingEvent>): ReturnType<typeof fakeBilling> =>
  fakeBilling({ verify: () => ok(webhook) });

const billingRejecting = (rejection: WebhookRejection): ReturnType<typeof fakeBilling> =>
  fakeBilling({ verify: () => err(rejection) });

const opened = (): Workspace => {
  const result = Workspace.open(ws, "Acme", founder, at);
  if (!isOk(result)) throw new Error("open should succeed");
  return result.value.workspace;
};

const members = (n: number): ReadonlyMap<string, readonly Membership[]> =>
  new Map([
    [
      "ws_1",
      Array.from({ length: n }, (_, i) => ({
        account: AccountId(`acct_${i}`),
        role: "member" as const,
        since: at,
      })),
    ],
  ]);

const deps = (overrides: {
  workspaces?: ReturnType<typeof fakeWorkspaces>;
  subscriptions?: ReturnType<typeof fakeSubscriptions>;
  ledger?: ReturnType<typeof fakeLedger>;
  billing: ReturnType<typeof fakeBilling>;
}) => ({
  billing: overrides.billing,
  workspaces: overrides.workspaces ?? fakeWorkspaces(opened()),
  subscriptions: overrides.subscriptions ?? fakeSubscriptions(Subscription.none(ws, at)),
  memberships: fakeMemberships(members(1)),
  ledger: overrides.ledger ?? fakeLedger(),
});

const request = { body: "{}", signature: "t=1,v1=abc" };

describe("a verified checkout", () => {
  test("upgrades the subscription and the workspace in one pass", async () => {
    const workspaces = fakeWorkspaces(opened());
    const subscriptions = fakeSubscriptions(Subscription.none(ws, at));
    const d = deps({ billing: billingThat(verified(checkout)), workspaces, subscriptions });

    const result = await recordBillingEvent(d, request, at);

    if (!isOk(result)) throw new Error("a verified checkout should apply");
    expect(result.value.kind).toBe("applied");

    expect((await subscriptions.find(ws))?.payment).toBe("active");
    const workspace = await workspaces.find(ws);
    expect(workspace?.entitlement.plan).toBe("pro");
    expect(workspace?.limits.maxProjects).toBeNull();
    expect(workspaces.events.map((e) => e.kind)).toEqual([
      "PlanChanged",
      "PaymentStateChanged",
      "LimitsChanged",
    ]);
  });

  test("a first-time subscriber with no subscription row still gets upgraded", async () => {
    // v1's UPDATE matched zero rows here and reported success, so the customer
    // paid for nothing.
    const workspaces = fakeWorkspaces(opened());
    const subscriptions = fakeSubscriptions();
    const d = deps({ billing: billingThat(verified(checkout)), workspaces, subscriptions });

    const result = await recordBillingEvent(d, request, at);

    expect(isOk(result)).toBe(true);
    expect((await subscriptions.find(ws))?.plan).toBe("pro");
    expect((await workspaces.find(ws))?.entitlement.plan).toBe("pro");
  });
});

describe("at-least-once delivery", () => {
  test("a redelivery is claimed once and writes nothing the second time", async () => {
    const workspaces = fakeWorkspaces(opened());
    const subscriptions = fakeSubscriptions(Subscription.none(ws, at));
    const ledger = fakeLedger();
    const d = deps({ billing: billingThat(verified(checkout)), workspaces, subscriptions, ledger });

    await recordBillingEvent(d, request, at);
    const savesAfterFirst = workspaces.saves;

    const again = await recordBillingEvent(d, request, at);
    if (!isOk(again)) throw new Error("a redelivery should be acknowledged");
    expect(again.value).toEqual({ kind: "duplicate", event: "evt_1" });
    expect(workspaces.saves).toBe(savesAfterFirst);
    expect(ledger.processed).toEqual(["evt_1"]);
  });

  test("a different event id with the same effect emits nothing new", async () => {
    // The second line of defence: even if the ledger claim were lost, an
    // unchanged standing produces no events, so no duplicate email.
    const workspaces = fakeWorkspaces(opened());
    const subscriptions = fakeSubscriptions(Subscription.none(ws, at));
    const ledger = fakeLedger();

    await recordBillingEvent(
      deps({ billing: billingThat(verified(checkout)), workspaces, subscriptions, ledger }),
      request,
      at,
    );
    const eventsAfterFirst = workspaces.events.length;

    await recordBillingEvent(
      deps({
        billing: billingThat(verified(checkout, { id: "evt_2" })),
        workspaces,
        subscriptions,
        ledger,
      }),
      request,
      at,
    );

    expect(workspaces.events).toHaveLength(eventsAfterFirst);
  });
});

describe("what is acknowledged rather than retried", () => {
  test("an event we do not translate", async () => {
    const ledger = fakeLedger();
    const result = await recordBillingEvent(
      deps({ billing: billingThat(verified(null)), ledger }),
      request,
      at,
    );
    if (!isOk(result)) throw new Error("an untranslated event should be acknowledged");
    expect(result.value).toEqual({ kind: "ignored", reason: "not_actionable", event: "evt_1" });
    expect(ledger.processed).toEqual(["evt_1"]);
  });

  test("an event about a workspace nothing here matches", async () => {
    const result = await recordBillingEvent(
      deps({
        billing: billingThat(verified(checkout, { workspace: null })),
        subscriptions: fakeSubscriptions(),
      }),
      request,
      at,
    );
    if (!isOk(result)) throw new Error("an unidentifiable event should be acknowledged");
    expect(result.value).toEqual({ kind: "ignored", reason: "unknown_workspace", event: "evt_1" });
  });

  test("a subscription row whose workspace is gone", async () => {
    const result = await recordBillingEvent(
      deps({ billing: billingThat(verified(checkout)), workspaces: fakeWorkspaces() }),
      request,
      at,
    );
    if (!isOk(result)) throw new Error("a missing workspace should be acknowledged");
    expect(result.value).toMatchObject({ kind: "ignored", reason: "unknown_workspace" });
  });
});

describe("verification failures are errors, not acknowledgements", () => {
  test("a bad signature never reaches the ledger", async () => {
    const ledger = fakeLedger();
    const result = await recordBillingEvent(
      deps({ billing: billingRejecting({ kind: "BadSignature" }), ledger }),
      request,
      at,
    );

    if (!isErr(result)) throw new Error("a bad signature should be refused");
    expect(result.error).toEqual({ kind: "BadSignature" });
    expect(ledger.processed).toEqual([]);
  });

  test("every rejection has exactly one domain error", () => {
    expect(fromWebhookRejection({ kind: "BadSignature" })).toEqual({ kind: "BadSignature" });
    expect(fromWebhookRejection({ kind: "Stale", ageSeconds: 900 })).toEqual({
      kind: "Stale",
      ageSeconds: 900,
    });
    expect(fromWebhookRejection({ kind: "Malformed", detail: "no data.object" })).toEqual({
      kind: "Malformed",
      detail: "no data.object",
    });
  });
});

describe("a downgrade found by the workspace", () => {
  test("reports being over the project cap and deletes nothing", async () => {
    const registered = opened().registerProject(ProjectId("p1"), "Web", at);
    if (!isOk(registered)) throw new Error("registration should succeed");

    const workspaces = fakeWorkspaces(registered.value.workspace);
    const paid: Subscription = {
      workspace: ws,
      plan: "pro",
      payment: "active",
      customer: "cus_1",
      subscription: "sub_1",
      renewsAt: null,
      updatedAt: at,
    };
    const subscriptions = fakeSubscriptions(paid);

    // A pro workspace holding four projects, then cancelled.
    let workspace = registered.value.workspace.applyStanding(
      { plan: "pro", payment: "active" },
      { seats: 1 },
      at,
    ).workspace;
    for (const id of ["p2", "p3", "p4"]) {
      const more = workspace.registerProject(ProjectId(id), id, at);
      if (!isOk(more)) throw new Error("pro is uncapped");
      workspace = more.value.workspace;
    }
    workspaces.seed(workspace);

    const cancel: BillingEvent = { kind: "subscription_canceled", subscription: "sub_1" };
    const result = await recordBillingEvent(
      deps({
        billing: billingThat(verified(cancel, { type: "customer.subscription.deleted" })),
        workspaces,
        subscriptions,
      }),
      request,
      at,
    );

    expect(isOk(result)).toBe(true);
    expect(workspaces.events.map((e) => e.kind)).toEqual([
      "PaymentStateChanged",
      "LimitsChanged",
      "OverProjectLimit",
    ]);
    expect((await workspaces.find(ws))?.projects).toHaveLength(4);
  });
});
