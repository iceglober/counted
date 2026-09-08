/**
 * The quota, from an HTTP request to a status code.
 *
 * `quota.test.ts` beside this proves the derived quota decides correctly.
 * `route.test.ts` proves the route turns a verdict into a status. Neither
 * proves they are wired to each other, and "wired to each other" is the whole
 * question: v1's ingest returned **202 with the event silently discarded** when
 * a workspace was past its allowance — byte for byte the same response as
 * success — so a customer could be losing every event and see nothing but 202s.
 * A quota that is computed and not consulted reproduces that exactly.
 *
 * So this file builds the real thing: `createServer`, a real `GroupCommit`, the
 * real `derivedIngestQuota` over an engine that reports a period's usage, and a
 * sink that records what actually got written. The only doubles are the two
 * things a test cannot have — the analytics store and the credential store.
 *
 * The two properties the report has to be able to claim:
 *
 *   - a customer cannot exceed their allowance with no consequence, and
 *   - a paying customer is not refused at a free customer's number.
 *
 * They are the same test run twice with one input changed, which is why they
 * are written as such.
 */

import { describe, expect, test } from "bun:test";
import {
  Duration,
  Instant,
  ProjectId,
  WorkspaceId,
  ok,
  type Result,
} from "@counted/kernel";
import type { AnalyticsEngine, Bucket } from "@counted/analytics-ports";
import {
  DEFAULT_GROUP_COMMIT_POLICY,
  GroupCommit,
  type EventSink,
  type WriteFailure,
  type WriteReceipt,
} from "@counted/ingestion-app";
import {
  Entitlement,
  OVERAGE_MULTIPLE,
  PlanCatalog,
  Workspace,
  workspaceUsage,
  type PaymentState,
  type PlanId,
} from "@counted/tenancy-domain";
import { createServer } from "../server";
import { authorizeDeps } from "../index";
import { silentLogger } from "../logging";
import { derivedIngestQuota } from "./quota";
import {
  fixedCredentials,
  fixedGeo,
  frozenClock,
  ingestCredential,
  testDependencies,
  unavailableEngine,
} from "../testing";

const AT = Instant.fromEpochMillis(Date.UTC(2026, 2, 15, 12));
const WS = WorkspaceId("ws_1");
const PRJ = ProjectId("prj_1");
const KEY = "ck_ingest";

/** The free plan's published allowance. Read from the catalog, not retyped. */
const FREE_LIMIT = PlanCatalog.limitsFor("free").eventsPerMonth ?? 0;
const PRO_LIMIT = PlanCatalog.limitsFor("pro").eventsPerMonth ?? 0;

/** An engine that answers the period query with a fixed count. */
const reporting = (used: number, calls: { n: number } = { n: 0 }): AnalyticsEngine =>
  unavailableEngine({
    counts: async () => {
      calls.n += 1;
      const buckets: Bucket[] = [{ start: AT, value: used }];
      return { ok: true, value: { buckets }, computedAt: AT };
    },
  });

type World = {
  /** Events the sink was actually handed. Zero is what "silently discarded" looks like. */
  readonly written: number[];
  request(events: number): Promise<Response>;
};

const build = (options: {
  readonly used: number;
  readonly plan?: PlanId;
  readonly payment?: PaymentState;
  readonly engine?: AnalyticsEngine;
}): World => {
  const written: number[] = [];
  const sink: EventSink = {
    writeBatch: async (_project, events): Promise<Result<WriteReceipt, WriteFailure>> => {
      written.push(events.length);
      return ok({ written: events.length, writtenIndices: events.map((_, index) => index), deduplicated: 0 });
    },
  };

  const clock = frozenClock(AT);
  const quota = derivedIngestQuota({
    projectCreatedAt: async () => AT,
    engine: options.engine ?? reporting(options.used),
    projectWorkspace: async () => WS,
    workspaceEntitlement: async () =>
      Entitlement.resolve(options.plan ?? "free", options.payment ?? "active"),
    logger: silentLogger,
    deadline: Duration.seconds(5),
  });

  const commit = new GroupCommit({
    sink,
    quota,
    clock,
    // One waiter closes the group, so a single request commits without a
    // timer. The transport arms that timer in `main.ts`; a test that relied on
    // it would be a test of `setTimeout`.
    policy: { ...DEFAULT_GROUP_COMMIT_POLICY, maxWaiters: 1 },
  });

  const deps = testDependencies({ clock, quota, sink });
  const app = createServer({
    deps,
    authorize: authorizeDeps(deps),
    ingest: {
      credentials: fixedCredentials({ [KEY]: ingestCredential(PRJ, WS) }),
      commit,
      projectWorkspace: async () => WS,
      logger: silentLogger,
      maxBodyBytes: 1_000_000,
      geo: fixedGeo(),
      trustedProxyHops: 1,
    },
    webhook: null,
    mintTraceId: () => "trace-quota",
  });

  return {
    written,
    request: async (events: number) =>
      app.request("http://api.test/v1/events", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          events: Array.from({ length: events }, (_, index) => ({
            name: "page_view",
            visitId: "1770000000.abcd1234",
            occurredAt: Instant.toISO(AT),
            idempotencyKey: `k-${index}`,
          })),
        }),
      }),
  };
};

describe("under the allowance", () => {
  test("a batch well inside the plan is stored, and the sink sees it", async () => {
    const world = build({ used: 10 });
    const response = await world.request(3);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: 3, rejected: 0 });
    expect(world.written).toEqual([3]);
  });
});

describe("past the allowance", () => {
  test("a customer at exactly 100% is still stored, because that is the overage band", async () => {
    // Cutting somebody off at exactly their limit mid-month loses data over a
    // rounding error. `usage.events.state` calls this `overage`, and overage
    // accepts — that is the point of the third state existing at all.
    const world = build({ used: FREE_LIMIT - 1 });
    const response = await world.request(1);
    expect(response.status).toBe(202);
    expect(world.written).toEqual([1]);

    const decision = workspaceUsage(freeWorkspace(), { events: FREE_LIMIT, seats: 1 });
    expect(decision.events.state).toBe("overage");
  });

  test("a customer past the overage band is refused with 402, and nothing is written", async () => {
    // The v1 failure this closes: 202 with the batch discarded, indistinguishable
    // from success. Here the status says "upgrade", `retryable` is false so the
    // SDK stops resending, and the sink was never called.
    const used = Math.ceil(FREE_LIMIT * OVERAGE_MULTIPLE) + 1;
    const world = build({ used });
    const response = await world.request(5);

    expect(response.status).toBe(402);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("PAYMENT_REQUIRED");
    expect(body["retryable"]).toBe(false);
    expect(body["limit"]).toBe(FREE_LIMIT);
    expect(world.written).toEqual([]);

    const decision = workspaceUsage(freeWorkspace(), { events: used, seats: 1 });
    expect(decision.events.state).toBe("rejected");
  });

  test("the refusal is the batch's, not the request's: the events are not half-written", async () => {
    const world = build({ used: Math.ceil(FREE_LIMIT * OVERAGE_MULTIPLE) + 1 });
    await world.request(50);
    expect(world.written).toEqual([]);
  });
});

describe("a paying customer at the same number", () => {
  test("is not refused, because the allowance is the plan's and not a constant", async () => {
    // Same usage that just produced a 402 on free. If this ever fails, somebody
    // has hard-coded a limit somewhere that `PlanCatalog` does not own.
    const used = Math.ceil(FREE_LIMIT * OVERAGE_MULTIPLE) + 1;
    const world = build({ used, plan: "pro" });
    const response = await world.request(5);
    expect(response.status).toBe(202);
    expect(world.written).toEqual([5]);
  });

  test("is refused only past Pro's own band — the published 'above 1M, let's talk' line", async () => {
    const world = build({ used: Math.ceil(PRO_LIMIT * OVERAGE_MULTIPLE) + 1, plan: "pro" });
    const response = await world.request(1);
    expect(response.status).toBe(402);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      limit: PRO_LIMIT,
    });
  });

  test("a past-due card does not cut a customer off — the plan is honoured in grace", async () => {
    // `Entitlement.resolve` keeps the plan and flags `inGrace`. Dropping a
    // paying customer to free the instant a card expires is a worse failure
    // than carrying them for a cycle, and it would show up here as a 402 for
    // somebody whose only problem is an expired card.
    const world = build({
      used: Math.ceil(FREE_LIMIT * OVERAGE_MULTIPLE) + 1,
      plan: "pro",
      payment: "past_due",
    });
    expect((await world.request(2)).status).toBe(202);
    expect(world.written).toEqual([2]);
  });

  test("a canceled subscription is metered as free, not as the plan it used to hold", async () => {
    const world = build({
      used: Math.ceil(FREE_LIMIT * OVERAGE_MULTIPLE) + 1,
      plan: "pro",
      payment: "canceled",
    });
    expect((await world.request(2)).status).toBe(402);
    expect(world.written).toEqual([]);
  });
});

describe("when the usage reading fails", () => {
  test("the batch is admitted, because the outage is ours", async () => {
    // Refusing would take a customer's data away over a failure on our side;
    // admitting costs us one refresh window of overage. The log is what stops
    // it being silent, and `quota.test.ts` pins the warning.
    const world = build({ used: 0, engine: unavailableEngine() });
    expect((await world.request(4)).status).toBe(202);
    expect(world.written).toEqual([4]);
  });
});

/** A free workspace, for computing what `usage.events.state` would report. */
const freeWorkspace = (): Workspace => {
  const opened = Workspace.open(WS, "Acme", ingestCredential(PRJ, WS).issuedBy, AT);
  if (!opened.ok) throw new Error("unreachable: a named workspace opens");
  return opened.value.workspace;
};
