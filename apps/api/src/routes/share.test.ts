/**
 * Share links, over stub ports.
 *
 * The properties that matter are the ones v1 lacked entirely: a link expires,
 * a link can be revoked, a link reads exactly one dashboard and nothing else,
 * and the response says not to index it.
 */

import { describe, expect, test } from "bun:test";
import {
  Analysis,
  Dashboard,
  DashboardId,
  Duration,
  Instant,
  Principal,
  ProjectId,
  Tile,
  TileId,
  TileWidth,
  Window,
  WorkspaceId,
  type Placement,
} from "@counted/domain";
import { DashboardViewSchema, DashboardDataResponseSchema } from "@counted/contracts";
import type { AnalyticalStore, EventWriter, Outcome, StoreResult } from "@counted/ports";
import { createApp } from "../server";
import { Coalescer } from "../ingest/coalescer";
import { stubAccess, silentLogger } from "../server.test";
import type { Config, Dependencies } from "../composition";
import { noConsole, noMail } from "../testing/stubs";

const NOW = Date.parse("2026-03-17T15:00:00.000Z");
const at = Instant.fromEpochMillis(NOW);
const WS = WorkspaceId("22222222-2222-2222-2222-222222222222");
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");
const OTHER_PRJ = ProjectId("33333333-3333-3333-3333-333333333399");
const DASH = DashboardId("55555555-5555-5555-5555-555555555555");
const OTHER_DASH = DashboardId("55555555-5555-5555-5555-555555555599");

const OWNER_KEY = "sk_owner_key_value";
const SHARE_TOKEN = "st_stubGrantTokenValue000000";

const config: Config = { databaseUrl: "postgres://stub", port: 8080, appUrl: "https://app.counted.test", stripe: { secretKey: "sk_test", webhookSecret: "whsec_test", monthlyPrice: "price_m", annualPrice: "price_a" }, email: { apiKey: "", from: "Counted <test@counted.test>" }, release: "test" };


const owner: Principal = {
  kind: "service",
  credential: "c" as never,
  workspace: WS,
  projects: "all",
  scopes: ["dashboards:read", "dashboards:write", "queries:run"],
  onBehalfOf: "acc" as never,
};

const sharePrincipal: Principal = {
  kind: "share",
  credential: "share_1" as never,
  dashboard: DASH,
  projects: [PRJ],
  scopes: ["dashboards:read", "queries:run"],
};

const tile = (n: number, project = PRJ): Tile =>
  Tile.of(
    TileId(`tile_${n}`),
    `Tile ${n}`,
    project,
    { kind: "analysis", analysis: Analysis.countOverWindow(Window.lastDays(7)), view: "number" },
    TileWidth.THIRD,
  );

const dashboardOf = (tiles: readonly Tile[], share: { digest: string; expiresAt: Instant } | null = null): Dashboard =>
  Dashboard.rehydrate({ id: DASH, workspace: WS, name: "Main", tiles, isDefault: true, share });

type Harness = {
  dashboards?: Map<string, Dashboard>;
  principals?: Record<string, Principal>;
};

const scalar: Outcome<StoreResult> = {
  ok: true,
  value: { kind: "scalar", value: 7 },
  from: "store",
  computedAt: at,
};

const app = (h: Harness = {}) => {
  const dashboards = h.dashboards ?? new Map<string, Dashboard>([[String(DASH), dashboardOf([tile(0)])]]);
  const writer: EventWriter = {
    append: async () => ({ accepted: 0, deduplicated: 0, written: [], committedAt: at }),
  };
  const store: AnalyticalStore = {
    executeBatch: async (requests) => ({
      results: new Map(requests.map((r) => [r.id, scalar])),
      stats: { statements: requests.length, totalMs: 1, coalesced: 0 },
    }),
    capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
  };
  const repos = {
    dashboards: {
      find: async (id: unknown) => dashboards.get(String(id)) ?? null,
      save: async (d: Dashboard) => void dashboards.set(String(d.snapshot().id), d),
    },
  };

  const deps: Dependencies = {
    access: stubAccess({
      principals: { [OWNER_KEY]: owner, [SHARE_TOKEN]: sharePrincipal, ...(h.principals ?? {}) },
      placements: {
        [DASH]: { workspace: WS, project: null } as Placement,
        [OTHER_DASH]: { workspace: WS, project: null },
        [PRJ]: { workspace: WS, project: PRJ },
        [OTHER_PRJ]: { workspace: WS, project: OTHER_PRJ },
      },
    }),
    log: silentLogger(),
    console: noConsole,
    notifier: noMail,
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

    ids: { next: () => "00000000-0000-7000-8000-000000000000" },
    grants: { issue: () => SHARE_TOKEN },
    // A digest that is the token, so the stub resolver can be keyed on it.
    secrets: {
      issue: () => ({ secret: "", digest: "" as never, prefix: "" as never }),
      digest: (s) => s as never,
    },
    quota: { decide: async () => ({ kind: "accept", used: 0, limit: null }) },
    ingest: new Coalescer(writer, { windowMs: 0 }),
    writer,
    store,
    unitOfWork: { transact: async (work: (r: unknown) => unknown) => work(repos) } as unknown as Dependencies["unitOfWork"],
    clock: { now: () => at },
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
  return { app: createApp(deps), dashboards };
};

const asOwner = (method: string, path: string, payload?: unknown, h?: Harness) => {
  const { app: a, dashboards } = app(h);
  return {
    dashboards,
    response: a.request(path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${OWNER_KEY}` },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  };
};

const asShare = (method: string, path: string, h?: Harness, token = SHARE_TOKEN) =>
  app(h).app.request(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(method === "POST" ? { body: "{}" } : {}),
  });

describe("minting a link", () => {
  test("returns the token exactly once, with an expiry", async () => {
    const res = await asOwner("POST", `/v1/dashboards/${DASH}/share`, { expiresInHours: 24 }).response;
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe(SHARE_TOKEN);
    expect(body.expiresAt).toBe("2026-03-18T15:00:00.000Z");
  });

  test("the dashboard afterwards reports that it is shared, never the token", async () => {
    // v1 had no way to revoke a link because there was nothing to revoke; here
    // there is, and reading it back must not disclose it.
    const { dashboards, response } = asOwner("POST", `/v1/dashboards/${DASH}/share`, {});
    await response;
    const view = await (
      await app({ dashboards }).app.request(`/v1/dashboards/${DASH}`, {
        headers: { authorization: `Bearer ${OWNER_KEY}` },
      })
    ).json();

    expect(DashboardViewSchema.safeParse(view).success).toBe(true);
    expect(view.share.active).toBe(true);
    expect(JSON.stringify(view)).not.toContain(SHARE_TOKEN);
  });

  test("an expiry is always set, even when the caller says nothing", async () => {
    // There is no value meaning "never". v1's tokens did not expire at all.
    const res = await asOwner("POST", `/v1/dashboards/${DASH}/share`, {}).response;
    expect((await res.json()).expiresAt).not.toBeNull();
  });

  test("only the digest is stored", async () => {
    const { dashboards, response } = asOwner("POST", `/v1/dashboards/${DASH}/share`, {});
    await response;
    const stored = dashboards.get(String(DASH))!.snapshot().share!;
    // The stub's digest is the identity function, so this asserts the shape of
    // the call rather than the hash: what is saved is what `digest()` returned.
    expect(stored.digest).toBe(SHARE_TOKEN);
    expect(Instant.toEpochMillis(stored.expiresAt)).toBeGreaterThan(NOW);
  });

  test("minting requires dashboards:write, not merely read", async () => {
    // A link is a way to read the data without logging in. Creating one is a
    // write, whatever it feels like.
    const reader: Principal = { ...owner, scopes: ["dashboards:read"] } as Principal;
    const res = await asOwner("POST", `/v1/dashboards/${DASH}/share`, {}, {
      principals: { [OWNER_KEY]: reader },
    }).response;
    expect(res.status).toBe(403);
  });

  test("an absurd expiry is refused", async () => {
    const res = await asOwner("POST", `/v1/dashboards/${DASH}/share`, { expiresInHours: 0 }).response;
    expect(res.status).toBe(422);
  });
});

describe("revoking a link", () => {
  test("revocation is immediate and the grant is gone", async () => {
    const shared = new Map([[String(DASH), dashboardOf([tile(0)], { digest: SHARE_TOKEN, expiresAt: Instant.plus(at, Duration.hours(24)) })]]);
    const { response } = asOwner("DELETE", `/v1/dashboards/${DASH}/share`, undefined, { dashboards: shared });
    expect((await response).status).toBe(204);
    expect(shared.get(String(DASH))!.snapshot().share).toBeNull();
  });

  test("revoking twice is not an error", async () => {
    // Not shared is the state the caller asked for.
    expect((await asOwner("DELETE", `/v1/dashboards/${DASH}/share`).response).status).toBe(204);
  });

  test("revoking a dashboard that does not exist is 404", async () => {
    const res = await asOwner("DELETE", `/v1/dashboards/${OTHER_DASH}/share`, undefined, {
      dashboards: new Map(),
    }).response;
    expect(res.status).toBe(404);
  });
});

describe("using a link", () => {
  test("it reads the dashboard it was issued for", async () => {
    const res = await asShare("GET", "/v1/shared/dashboard");
    expect(res.status).toBe(200);
    expect(DashboardViewSchema.safeParse(await res.json()).success).toBe(true);
  });

  test("it renders every tile in one batch", async () => {
    const dashboards = new Map([[String(DASH), dashboardOf([tile(0), tile(1), tile(2)])]]);
    const res = await asShare("POST", "/v1/shared/dashboard/render", { dashboards });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(DashboardDataResponseSchema.safeParse(body).success).toBe(true);
    expect(body.readouts).toHaveLength(3);
    expect(body.statements).toBe(3);
  });

  test("the response says not to index it", async () => {
    // v1's shared page had no robots directive at all.
    for (const [method, path] of [
      ["GET", "/v1/shared/dashboard"],
      ["POST", "/v1/shared/dashboard/render"],
    ] as const) {
      const res = await asShare(method, path);
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
      // And must not sit in a shared cache where the next person gets it.
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });

  test("an unknown token is 401, not a blank page", async () => {
    const res = await asShare("GET", "/v1/shared/dashboard", {}, "st_notARealTokenAtAll0000");
    expect(res.status).toBe(401);
  });

  test("a revoked link stops working immediately", async () => {
    // The digest is gone, so the resolver returns nobody.
    const res = await asShare("GET", "/v1/shared/dashboard", { principals: { [SHARE_TOKEN]: Principal.ANONYMOUS } });
    expect(res.status).toBe(401);
  });
});

describe("a link reads one dashboard and nothing else", () => {
  test("it cannot reach the owned dashboard endpoints", async () => {
    // Those resolve a dashboard from the path; a share principal is bound to
    // the one in its own grant, so naming another is outside the binding.
    for (const path of [`/v1/dashboards/${OTHER_DASH}`, `/v1/dashboards/${DASH}`]) {
      const res = await app().app.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${SHARE_TOKEN}` },
        body: JSON.stringify({ name: "Renamed" }),
      });
      expect({ path, status: res.status }).toMatchObject({ status: expect.any(Number) });
      expect(res.status).not.toBe(200);
    }
  });

  test("it cannot query a project its dashboard does not read", async () => {
    const res = await app().app.request(`/v1/projects/${OTHER_PRJ}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SHARE_TOKEN}` },
      body: JSON.stringify({
        question: {
          kind: "analysis",
          analysis: { measure: { kind: "count" }, window: { kind: "relative", amount: 7, unit: "day" } },
        },
      }),
    });
    expect(res.status).toBe(404);
  });

  test("it can query a project its dashboard does read", async () => {
    // Bound to the tiles' projects, so revoking a tile narrows the link.
    const res = await app().app.request(`/v1/projects/${PRJ}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SHARE_TOKEN}` },
      body: JSON.stringify({
        question: {
          kind: "analysis",
          analysis: { measure: { kind: "count" }, window: { kind: "relative", amount: 7, unit: "day" } },
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  test("it cannot write anything, anywhere", async () => {
    const attempts = [
      ["POST", `/v1/dashboards/${DASH}/share`],
      ["DELETE", `/v1/dashboards/${DASH}/share`],
      ["DELETE", `/v1/dashboards/${DASH}`],
      ["POST", `/v1/workspaces/${WS}/dashboards`],
      ["POST", `/v1/events`],
    ] as const;
    for (const [method, path] of attempts) {
      const res = await app().app.request(path, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${SHARE_TOKEN}` },
        body: JSON.stringify({ name: "x" }),
      });
      expect({ method, path, ok: res.ok }).toMatchObject({ ok: false });
    }
  });
});
