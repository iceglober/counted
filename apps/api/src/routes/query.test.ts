/**
 * The reading endpoints, over stub ports.
 *
 * What matters here is the wire: that every response is tagged, that a failure
 * is visible rather than blank, and that the ISO/millisecond translation is
 * done rather than cast.
 */

import { describe, expect, test } from "bun:test";
import {
  Analysis,
  Dashboard,
  DashboardId,
  FieldRef,
  Instant,
  Measure,
  Principal,
  ProjectId,
  Tile,
  TileId,
  TileWidth,
  Window,
  WorkspaceId,
  type Placement,
} from "@counted/domain";
import { QueryResponseSchema, DashboardDataResponseSchema } from "@counted/contracts";
import type { AnalyticalStore, EventWriter, Outcome, StoreRequest, StoreResult } from "@counted/ports";
import { createApp } from "../server";
import { Coalescer } from "../ingest/coalescer";
import { stubAccess, silentLogger } from "../server.test";
import type { Config, Dependencies } from "../composition";

const NOW = Date.parse("2026-03-17T15:00:00.000Z");
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");
const WS = WorkspaceId("ws_1");
const DASH = DashboardId("55555555-5555-5555-5555-555555555555");
const KEY = "sk_service_key";

const placement: Placement = { workspace: WS, project: PRJ };

const servicePrincipal: Principal = {
  kind: "service",
  credential: "cred_1" as never,
  workspace: WS,
  projects: "all",
  scopes: ["queries:run", "dashboards:read"],
  onBehalfOf: "acc_1" as never,
};

const config: Config = { databaseUrl: "postgres://stub", port: 8080, appUrl: "https://app.counted.test", stripe: { secretKey: "sk_test", webhookSecret: "whsec_test", monthlyPrice: "price_m", annualPrice: "price_a" }, release: "test" };

type Harness = {
  answer?: (r: StoreRequest) => Outcome<StoreResult>;
  dashboard?: Dashboard | null;
  calls?: StoreRequest[][];
};

const scalar = (value: number): Outcome<StoreResult> => ({
  ok: true,
  value: { kind: "scalar", value },
  from: "store",
  computedAt: Instant.fromEpochMillis(NOW),
});

const app = (h: Harness = {}) => {
  const calls = h.calls ?? [];
  const store: AnalyticalStore = {
    executeBatch: async (requests) => {
      calls.push([...requests]);
      return {
        results: new Map(requests.map((r) => [r.id, (h.answer ?? (() => scalar(42)))(r)])),
        stats: { statements: requests.length, totalMs: 1, coalesced: 0 },
      };
    },
    capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
  };
  const writer: EventWriter = {
    append: async () => ({ accepted: 0, deduplicated: 0, written: [], committedAt: Instant.fromEpochMillis(NOW) }),
  };
  const deps: Dependencies = {
    access: stubAccess({
      principals: { [KEY]: servicePrincipal },
      placements: { [PRJ]: placement, [DASH]: { workspace: WS, project: null } },
    }),
    log: silentLogger(),
  billing: {
    createCheckoutSession: async () => ({ url: "https://checkout.stripe.test/session", expiresAt: null }),
    createPortalSession: async () => ({ url: "https://portal.stripe.test/session", expiresAt: null }),
    verifyWebhook: () => ({ ok: false as const, error: { reason: "bad_signature" as const } }),
  },
  subscriptions: {
    find: async () => null,
    findByCustomer: async () => null,
    findBySubscriptionRef: async () => null,
    save: async () => {},
  },
  webhooks: { claim: async () => true, markProcessed: async () => {} },
  usage: { eventsInCurrentPeriod: async () => 0 },

  grants: { issue: (kind: "share" | "claim") => `${kind === "share" ? "st" : "ct"}_stubGrantTokenValue000000` },
  ids: { next: () => "00000000-0000-7000-8000-000000000000" },
    secrets: { issue: () => ({ secret: "", digest: "" as never, prefix: "" as never }), digest: (s) => s as never },
    quota: { decide: async () => ({ kind: "accept", used: 0, limit: null }) },
    ingest: new Coalescer(writer, { windowMs: 0 }),
    writer,
    store,
    unitOfWork: {
      transact: async (work: (r: { dashboards: { find: (id: DashboardId) => Promise<Dashboard | null> } }) => unknown) =>
        work({ dashboards: { find: async () => (h.dashboard === undefined ? null : h.dashboard) } }),
    } as unknown as Dependencies["unitOfWork"],
    clock: { now: () => Instant.fromEpochMillis(NOW) },
    boot: {
      capabilities: {
        engine: "stub",
        approximateDistinct: false,
        partitioning: "declarative",
        serverVersion: "17",
        timescale: false,
        timeZone: "UTC",
      },
      bucketContract: { ok: true, checked: 48 },
    } as Dependencies["boot"],
    config,
    shutdown: async () => {},
  };
  return createApp(deps);
};

const query = (question: unknown, h: Harness = {}) =>
  app(h).request(`/v1/projects/${PRJ}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ question }),
  });

const countQuestion = {
  kind: "analysis",
  analysis: { measure: { kind: "count" }, window: { kind: "relative", amount: 7, unit: "day" } },
};

describe("every response says what shape it is", () => {
  test("a scalar answer is tagged and validates", async () => {
    const res = await query(countQuestion);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(QueryResponseSchema.safeParse(body).success).toBe(true);
    expect(body.value).toMatchObject({ shape: "scalar", value: 42 });
  });

  test("a series answer carries dated points, not bare numbers", async () => {
    // v1's `/query` multiplexed three shapes with no discriminator, so the
    // client reconstructed the branch condition itself.
    const res = await query(
      {
        kind: "analysis",
        analysis: {
          measure: { kind: "count" },
          window: { kind: "relative", amount: 3, unit: "day" },
          groupBy: [{ by: "time", grain: "day" }],
        },
      },
      {
        answer: (r) =>
          r.kind === "series"
            ? {
                ok: true,
                value: { kind: "series", values: new Array(r.axis.edges.length - 1).fill(5) },
                from: "store",
                computedAt: Instant.fromEpochMillis(NOW),
              }
            : scalar(0),
      },
    );
    const body = await res.json();
    expect(body.value.shape).toBe("series");
    expect(body.value.points[0]).toHaveProperty("bucketStart");
    expect(typeof body.value.points[0].bucketStart).toBe("string");
    expect(QueryResponseSchema.safeParse(body).success).toBe(true);
  });

  test("a breakdown answer is rows, tagged", async () => {
    const res = await query(
      {
        kind: "analysis",
        analysis: {
          measure: { kind: "count" },
          window: { kind: "relative", amount: 7, unit: "day" },
          groupBy: [{ by: "field", field: { source: "system", key: "os_name" } }],
        },
      },
      {
        answer: () => ({
          ok: true,
          value: { kind: "breakdown", rows: [{ label: "macos", value: 3 }] },
          from: "store",
          computedAt: Instant.fromEpochMillis(NOW),
        }),
      },
    );
    const body = await res.json();
    expect(body.value).toMatchObject({ shape: "breakdown", rows: [{ label: "macos", value: 3 }] });
  });
});

describe("funnels and retention are reachable over the API", () => {
  test("a funnel returns rates the domain derived", async () => {
    const res = await query(
      {
        kind: "funnel",
        funnel: {
          steps: [{ events: ["view"] }, { events: ["signup"] }],
          window: { kind: "relative", amount: 7, unit: "day" },
          conversionWindowMs: 86_400_000,
        },
      },
      {
        answer: () => ({
          ok: true,
          value: { kind: "sequence", counts: [100, 20] },
          from: "store",
          computedAt: Instant.fromEpochMillis(NOW),
        }),
      },
    );
    const body = await res.json();
    expect(body.value.shape).toBe("funnel");
    expect(body.value.steps[1]).toMatchObject({ reached: 20, rate: 20, droppedOff: 80 });
  });

  test("retention is answerable, for the first time", async () => {
    // v1 had no API for it at all, and its UI version was ~0 by construction.
    const cohortStart = Instant.fromEpochMillis(Date.parse("2026-03-09T00:00:00.000Z"));
    const res = await query(
      {
        kind: "retention",
        retention: {
          window: { kind: "relative", amount: 4, unit: "week" },
          grain: "week",
          periods: 3,
          basis: "person",
        },
      },
      {
        answer: () => ({
          ok: true,
          value: {
            kind: "cohorts",
            sizes: [{ cohortStart, size: 10 }],
            observations: [{ cohortStart, periodStart: cohortStart, returned: 10 }],
          },
          from: "store",
          computedAt: Instant.fromEpochMillis(NOW),
        }),
      },
    );
    const body = await res.json();
    expect(body.value.shape).toBe("retention");
    expect(body.value.cohorts[0].size).toBe(10);
    // A period that has not begun is null, not zero.
    expect(body.value.cohorts[0].cells.some((c: unknown) => c === null)).toBe(true);
    expect(QueryResponseSchema.safeParse(body).success).toBe(true);
  });

  test("retention on visits cannot be asked for", async () => {
    // A visit expires after thirty minutes idle, so every cohort past period 0
    // was structurally ~0 — and v1 labelled the column "Users".
    const res = await query({
      kind: "retention",
      retention: {
        window: { kind: "relative", amount: 4, unit: "week" },
        grain: "week",
        periods: 3,
        basis: "visit",
      },
    });
    expect(res.status).toBe(422);
  });
});

describe("a failure is stated, never a blank", () => {
  test("a timeout is 504 with a retryable problem, not an empty chart", async () => {
    const res = await query(countQuestion, {
      answer: () => ({ ok: false, error: { code: "timeout", budgetMs: 500, retriable: true } }),
    });
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.retryable).toBe(true);
    expect(body.code).toBe("query.timeout");
  });

  test("an unavailable store is 503, not 200 with zeroes", async () => {
    const res = await query(countQuestion, {
      answer: () => ({ ok: false, error: { code: "store_unavailable", detail: "pool exhausted", retriable: true } }),
    });
    expect(res.status).toBe(503);
  });

  test("an unanswerable question is 422 and says why", async () => {
    const res = await query({
      kind: "analysis",
      analysis: {
        measure: { kind: "count" },
        window: { kind: "relative", amount: 24, unit: "month" },
        groupBy: [{ by: "time", grain: "hour" }],
      },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).detail).toContain("coarser grain");
  });

  test("a malformed body is 422 with every bad field", async () => {
    const res = await query({ kind: "analysis", analysis: { measure: { kind: "nonsense" } } });
    expect(res.status).toBe(422);
    expect((await res.json()).fields.length).toBeGreaterThan(0);
  });
});

describe("authorization", () => {
  test("queries:run is required", async () => {
    const res = await app().request(`/v1/projects/${PRJ}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: countQuestion }),
    });
    expect(res.status).toBe(401);
  });

  test("a project in another workspace is 404, not 403", async () => {
    const res = await app().request(`/v1/projects/33333333-3333-3333-3333-999999999999/query`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ question: countQuestion }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Dashboards ───────────────────────────────────────────────────────────────

const tile = (n: number): Tile =>
  Tile.of(
    TileId(`tile_${n}`),
    `Tile ${n}`,
    PRJ,
    { kind: "analysis", analysis: Analysis.countOverWindow(Window.lastDays(7)), view: "number" },
    TileWidth.THIRD,
  );

const dashboardOf = (tiles: readonly Tile[]): Dashboard =>
  Dashboard.rehydrate({ id: DASH, workspace: WS, name: "Main", tiles, isDefault: true, share: null });

const renderDashboard = (h: Harness = {}) =>
  app(h).request(`/v1/dashboards/${DASH}/data`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: "{}",
  });

describe("a dashboard is one call to the store", () => {
  test("twenty-four tiles produce one batch", async () => {
    // v1 looped and awaited each insight in turn — 24 serialised queries
    // against a pool of 20 shared with ingestion.
    const calls: StoreRequest[][] = [];
    const tiles = Array.from({ length: 24 }, (_, i) => tile(i));
    const res = await renderDashboard({ dashboard: dashboardOf(tiles), calls });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(24);

    const body = await res.json();
    expect(body.readouts).toHaveLength(24);
    expect(body.statements).toBe(24);
    expect(DashboardDataResponseSchema.safeParse(body).success).toBe(true);
  });

  test("each readout is tagged with its tile id", async () => {
    const body = await (await renderDashboard({ dashboard: dashboardOf([tile(0), tile(1)]) })).json();
    expect(body.readouts.map((r: { id: string }) => r.id)).toEqual(["tile_0", "tile_1"]);
  });

  test("one broken tile does not blank the others", async () => {
    let n = 0;
    const body = await (
      await renderDashboard({
        dashboard: dashboardOf([tile(0), tile(1), tile(2)]),
        answer: () =>
          n++ === 1
            ? { ok: false, error: { code: "timeout", budgetMs: 500, retriable: true } }
            : scalar(9),
      })
    ).json();

    expect(body.readouts.filter((r: { ok: boolean }) => r.ok)).toHaveLength(2);
    const failed = body.readouts.find((r: { ok: boolean }) => !r.ok);
    // Not `emptyData()`. The client can say "this one timed out".
    expect(failed.failure.code).toBe("timeout");
    expect(failed.failure.retriable).toBe(true);
  });

  test("an empty dashboard is a valid, empty render", async () => {
    const body = await (await renderDashboard({ dashboard: dashboardOf([]) })).json();
    expect(body.readouts).toEqual([]);
    expect(body.statements).toBe(0);
  });

  test("a dashboard that does not exist is 404", async () => {
    expect((await renderDashboard({ dashboard: null })).status).toBe(404);
  });

  test("dashboards:read is required", async () => {
    const res = await app({ dashboard: dashboardOf([tile(0)]) }).request(`/v1/dashboards/${DASH}/data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
