/**
 * One customer, start to finish, against a running API and a real Postgres.
 *
 * The nine steps below are the product: sign up, own a workspace, make a
 * project, send an event, ask a question, build a dashboard, share it, fail to
 * escalate, and pay. Each is a `test` and they run in order, because a journey
 * is not a set of independent facts — step 5 has nothing to count until step 4
 * has landed. Bun runs the file top to bottom in one process, which is what
 * makes that safe; a step that fails leaves the ones after it failing too, and
 * that is the correct signal rather than noise.
 *
 * **What makes this different from `bun test`.** Every unit suite in this
 * repository runs over in-memory doubles. Three defects survived 2,000 of those
 * tests, a clean `tsc`, and a clean dependency-cruiser, and every one of them
 * was found in the first minute of running this file:
 *
 *   - creating a project failed every time, because the workspace's project
 *     register is derived from the `projects` table and the route reserved the
 *     slot after writing the row — so the register already held it and the
 *     workspace refused with `ProjectExists`;
 *   - nothing ever wrote `public.analytics_org`, so litics' tenant filter
 *     matched no rows and every query answered zero, successfully, forever;
 *   - the billing namespace existed in `routes/billing.ts` and not in the
 *     contract, so `POST …/billing/checkout` was a 404 and no customer could
 *     upgrade.
 *
 * Nothing downstream of ingest — a readout, a share link, a unique count — had
 * ever run against a real segment before this file did.
 *
 * Run it with `bun run journey`. It needs the database from
 * `docker-compose.yml` — `docker compose up -d db` — and nothing else: it
 * starts its own API on a port of its own and its own payment-provider stub.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { dimensionOrdinal, LiticsEventRetention } from "@counted/analytics-adapter-litics";
import { Instant, ProjectId } from "@counted/kernel";
import {
  RUN,
  anonymous,
  at,
  call,
  connectAgent,
  database,
  deliverWebhook,
  isUnauthorized,
  num,
  flushSegments,
  sessionCookie,
  signStripe,
  startApi,
  startMcp,
  stripeEvent,
  stripeStub,
  str,
  type Agent,
  type Api,
  type Caller,
  type Mcp,
  type Stripe,
} from "./harness";
import { EXPOSED, WITHHELD } from "../../apps/mcp/src/exposure";
import { toolNameOf } from "../../apps/mcp/src/projection";

let api: Api;
let stripe: Stripe;
let db: Pool;

/** The person. Everything they do goes through this caller. */
const owner: Caller = anonymous();
/** The same journey seen through a service key issued on project A. */
const serviceKey: Caller = anonymous();
/** The ingest key project A is given. */
const ingestKey: Caller = anonymous();

const state = {
  account: "",
  workspace: "",
  projectA: "",
  projectB: "",
  ingestSecret: "",
  dashboard: "",
  otherDashboard: "",
  tile: "",
  shareToken: "",
  otherShareToken: "",
};

/** Three visits, four events, one of them a second event from the first visit. */
const EVENTS = 5;
const VISITS = 3;

beforeAll(async () => {
  stripe = stripeStub();
  api = await startApi(stripe);
  db = database();
});

afterAll(async () => {
  await db?.end();
  await api?.stop();
  await stripe?.stop();
});

describe("1 · sign up", () => {
  test("an account is created through better-auth and answers as itself", async () => {
    const signUp = await call(api, anonymous(), "POST", "/api/auth/sign-up/email", {
      email: `journey-${RUN}@counted.test`,
      password: `journey-${RUN}-correct-horse`,
      name: "Journey Owner",
    });
    expect(signUp.status).toBe(200);

    owner.cookie = sessionCookie(signUp);
    state.account = str(signUp.body, "user", "id");

    const me = await call(api, owner, "GET", "/v1/me");
    expect(me.status).toBe(200);
    expect(str(me.body, "account", "id")).toBe(state.account);
    expect(at(me.body, "workspaces")).toEqual([]);
  });

  test("the session is a row better-auth wrote, in the auth schema", async () => {
    // Where the tables live is not cosmetic: better-auth 1.7 has no schema
    // option and finds its tables through `search_path`. If the identity pool's
    // setting had not taken, they would be in `public`, better-auth would work,
    // and the one query that reads `auth.member` by name would return nothing.
    const rows = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM auth."user" WHERE id = $1`,
      [state.account],
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });
});

describe("2 · workspace", () => {
  test("creating one produces a plan and limits", async () => {
    const created = await call(api, owner, "POST", "/v1/workspaces", {
      name: `Journey ${RUN}`,
    });
    expect(created.status).toBe(201);
    state.workspace = str(created.body, "workspace", "id");
    expect(at(created.body, "workspace", "plan")).toBe("free");
    expect(num(created.body, "workspace", "limits", "projects")).toBe(3);
  });

  test("the organization and the workspace are one row each, sharing an id", async () => {
    const rows = await db.query<{ org: string; ws: string; role: string }>(
      `SELECT o.id AS org, w.id AS ws, m.role
         FROM auth.organization o
         JOIN workspaces w ON w.id = o.id
         JOIN auth.member m ON m."organizationId" = o.id AND m."userId" = $2
        WHERE o.id = $1`,
      [state.workspace, state.account],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.role).toBe("owner");
  });

  test("a reconciler would find nothing to repair, in either direction", async () => {
    // The half this ordering is designed to avoid is an organization with no
    // workspace: people belong to something no plan applies to, no limit
    // constrains and no invoice covers. The other half — a workspace nobody
    // belongs to — is visible in billing and fixable by hand.
    const orphans = await db.query<{ orgs_without_workspace: string; workspaces_without_org: string }>(
      `SELECT
         (SELECT count(*) FROM auth.organization o
            LEFT JOIN workspaces w ON w.id = o.id WHERE w.id IS NULL) AS orgs_without_workspace,
         (SELECT count(*) FROM workspaces w
            LEFT JOIN auth.organization o ON o.id = w.id WHERE o.id IS NULL) AS workspaces_without_org`,
    );
    expect(Number(orphans.rows[0]?.orgs_without_workspace)).toBe(0);
    expect(Number(orphans.rows[0]?.workspaces_without_org)).toBe(0);
  });

  test("killing it in the middle leaves neither row", async () => {
    // This is the two-write failure, provoked rather than asserted around. A
    // name of nothing but spaces passes the contract's `min(1)` and is refused
    // by `Workspace.open`, so the mirror throws *after* the organization and
    // the owner's membership have been inserted — inside better-auth's own
    // transaction. If those two writes were not in that transaction, an
    // organization would survive here.
    const before = await db.query<{ n: string }>(`SELECT count(*) AS n FROM auth.organization`);

    const refused = await call(api, owner, "POST", "/v1/workspaces", { name: "   " });
    expect(refused.status).toBe(500);
    expect(at(refused.body, "data", "reason")).toBe("NotProvisioned");

    const after = await db.query<{ n: string }>(`SELECT count(*) AS n FROM auth.organization`);
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n));
  });

  test("the workspace is a root of the analytics tenancy tree", async () => {
    const rows = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM analytics.org_tree WHERE ancestor = $1 AND descendant = $1`,
      [state.workspace],
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });
});

describe("3 · project", () => {
  test("creating one succeeds and takes a slot against the plan", async () => {
    const created = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/projects`, {
      name: `Journey project ${RUN}`,
    });
    expect(created.status).toBe(201);
    state.projectA = str(created.body, "project", "id");
    expect(str(created.body, "project", "workspace")).toBe(state.workspace);

    const usage = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}/usage`);
    expect(num(usage.body, "usage", "projects", "used")).toBe(1);
  });

  test("it is placed under its workspace in the tenancy tree", async () => {
    // Without this row litics' tenant filter — which resolves even a *project*
    // scope through the closure table — matches nothing, and every question
    // about this project answers zero and reports no error.
    const rows = await db.query<{ depth: number }>(
      `SELECT depth FROM analytics.org_tree WHERE ancestor = $1 AND descendant = $2`,
      [state.workspace, state.projectA],
    );
    expect(rows.rows[0]?.depth).toBe(1);
  });

  test("it has exactly one ingest credential, minted once", async () => {
    const listed = await call(api, owner, "GET", `/v1/projects/${state.projectA}/credentials`);
    expect(listed.status).toBe(200);
    const items = at(listed.body, "items");
    expect(Array.isArray(items)).toBe(true);
    expect((items as unknown[]).length).toBe(1);
    expect(at(items, 0, "kind")).toBe("ingest");
    expect(at(items, 0, "permissions")).toEqual(["events:write"]);
    expect(str(items, 0, "hint").startsWith("ck_")).toBe(true);
    // The hint is the only thing a list may carry. v1's key list returned the
    // full key for every key the caller could see.
    expect(at(items, 0, "secret")).toBeUndefined();
  });

  test("issuing one returns the secret exactly once, and never again", async () => {
    const issued = await call(api, owner, "POST", `/v1/projects/${state.projectA}/credentials`, {
      kind: "ingest",
      name: `journey ${RUN}`,
    });
    expect(issued.status).toBe(201);
    state.ingestSecret = str(issued.body, "issued", "secret");
    ingestKey.bearer = state.ingestSecret;
    expect(state.ingestSecret.startsWith("ck_")).toBe(true);

    const credential = str(issued.body, "issued", "credential", "id");
    const listed = await call(api, owner, "GET", `/v1/projects/${state.projectA}/credentials`);
    const mine = (at(listed.body, "items") as unknown[]).find(
      (item) => at(item, "id") === credential,
    );
    expect(mine).toBeDefined();
    expect(at(mine, "secret")).toBeUndefined();
    expect(JSON.stringify(listed.body)).not.toContain(state.ingestSecret);
  });

  test("the ingest key can say what it is, and nothing else", async () => {
    const self = await call(api, ingestKey, "GET", "/v1/me/credential");
    expect(self.status).toBe(200);
    expect(str(self.body, "credential", "project")).toBe(state.projectA);

    const nosy = await call(api, ingestKey, "GET", `/v1/projects/${state.projectA}`);
    expect(nosy.status).toBe(403);
  });
});

describe("4 · ingest", () => {
  test("a batch is accepted and acknowledged as durable", async () => {
    // One second apart, in the order sent: a funnel is an order, and five
    // events at the same instant have none. A few seconds in the past so the
    // last one is never ahead of the API's clock.
    const base = Date.now() - 10_000;
    let sequence = 0;
    const event = (name: string, visit: string) => ({
      name,
      visitId: `${RUN}-${visit}`,
      occurredAt: new Date(base + sequence++ * 1_000).toISOString(),
      idempotencyKey: `${RUN}-${name}-${visit}`,
      properties: { path: "/" },
      systemProperties: {
        os_name: "macOS",
        os_version: "26.0",
        locale: "en-GB",
        app_version: "1.2.3",
        device_model: "MacBook",
        sdk_version: "counted-js@1.0.0",
      },
    });

    const posted = await call(api, ingestKey, "POST", "/v1/events", {
      events: [
        event("page_view", "v1"),
        event("page_view", "v2"),
        event("page_view", "v3"),
        event("signup", "v1"),
        event("purchase", "v1"),
      ],
    });
    expect(posted.status).toBe(202);
    expect(num(posted.body, "accepted")).toBe(EVENTS);
    expect(num(posted.body, "rejected")).toBe(0);
  });

  test("the events are rows in litics' staging table", async () => {
    const rows = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM analytics.events WHERE tenant_id = $1`,
      [state.projectA],
    );
    expect(Number(rows.rows[0]?.n)).toBe(EVENTS);
  });

  test("a count is right before any pack has run", async () => {
    // The engine unions the staging tail into every read, so a query a second
    // after the write sees the number. This is what makes "no compactor yet"
    // a slower deployment rather than a wrong one.
    const window = { kind: "relative" as const, amount: 7, unit: "day" as const };
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: { shape: "scalar", measure: { kind: "count" }, window, summary: "total" },
    });
    expect(ran.status).toBe(200);
    expect(num(ran.body, "readout", "value", "value")).toBe(EVENTS);
  });

  test("after a pack a segment exists, its summary adds up, and staging is empty", async () => {
    await flushSegments(db);
    const segments = await db.query<{ n: string; segments: string }>(
      `SELECT coalesce(sum(n), 0)::text AS n, count(*)::text AS segments
         FROM analytics.events_segments WHERE tenant_id = $1`,
      [state.projectA],
    );
    expect(Number(segments.rows[0]?.n)).toBe(EVENTS);
    expect(Number(segments.rows[0]?.segments)).toBeGreaterThanOrEqual(1);
    const summary = await db.query<{ n: string }>(
      `SELECT coalesce(sum(s.n), 0)::text AS n
         FROM analytics.events_summary s WHERE s.tenant_id = $1`,
      [state.projectA],
    );
    expect(Number(summary.rows[0]?.n)).toBe(EVENTS);
    const staged = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM analytics.events WHERE tenant_id = $1`,
      [state.projectA],
    );
    expect(Number(staged.rows[0]?.n)).toBe(0);
  });
});

describe("5 · query", () => {
  const window = { kind: "relative" as const, amount: 7, unit: "day" as const };

  test("a count comes back with the right number in it", async () => {
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: { shape: "scalar", measure: { kind: "count" }, window, summary: "total" },
    });
    expect(ran.status).toBe(200);
    expect(num(ran.body, "readout", "value", "value")).toBe(EVENTS);
  });

  test("a unique count is the visits, not the events — the actor sketch answers", async () => {
    // The thing most likely to be misconfigured: `uniques` merges the actor
    // hashes the summary rows carry, and a wrong actor column produces a
    // number rather than an error. Four events from three visits is the
    // smallest case where the two differ.
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "scalar",
        measure: { kind: "unique", basis: "visit" },
        window,
        summary: "total",
      },
    });
    expect(ran.status).toBe(200);
    expect(num(ran.body, "readout", "value", "value")).toBe(VISITS);
  });

  test("a filter reaches one event name", async () => {
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "scalar",
        measure: { kind: "count" },
        where: { op: "eq", field: { source: "dimension", key: "event_type" }, value: "signup" },
        window,
        summary: "total",
      },
    });
    expect(num(ran.body, "readout", "value", "value")).toBe(1);
  });

  test("a series is dense — the empty days are zeros, not gaps", async () => {
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "series",
        measure: { kind: "count" },
        window: { kind: "relative", amount: 3, unit: "day" },
        grain: "day",
      },
    });
    const points = at(ran.body, "readout", "value", "points");
    expect(Array.isArray(points)).toBe(true);
    expect((points as unknown[]).length).toBe(4);
    const total = (points as unknown[]).reduce<number>((sum, p) => sum + num(p, "value"), 0);
    expect(total).toBe(EVENTS);
  });

  test("the schema catalog reports the event names this project actually sent", async () => {
    const schema = await call(api, owner, "GET", `/v1/projects/${state.projectA}/schema`);
    expect(at(schema.body, "schema", "events")).toEqual(["page_view", "purchase", "signup"]);
  });

  test("an SDK dimension filters — every event carried os_name=macos", async () => {
    // Six system properties travel from the SDK, through admission, into
    // dictionary-encoded columns. Nothing before this test proved any of them
    // arrive: the fixture used to send camelCase keys that admission ignored,
    // so every event landed with os_name="other" and no test noticed.
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "scalar",
        measure: { kind: "count" },
        // "macOS" on the wire, "macos" in the store: admission canonicalises the
        // dozen spellings clients use into one, and the raw one goes to props.
        where: { op: "eq", field: { source: "dimension", key: "os_name" }, value: "macos" },
        window,
        summary: "total",
      },
    });
    expect(ran.status).toBe(200);
    expect(num(ran.body, "readout", "value", "value")).toBe(EVENTS);
  });

  test("an SDK dimension groups a breakdown — one row, en-GB, all of them", async () => {
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "breakdown",
        measure: { kind: "count" },
        by: { source: "dimension", key: "locale" },
        window,
        order: "desc",
        limit: 10,
      },
    });
    expect(ran.status).toBe(200);
    expect(at(ran.body, "readout", "value", "rows")).toEqual([{ label: "en-GB", value: EVENTS }]);
  });

  test("a funnel follows one visit through three steps", async () => {
    // Three visits saw a page; one of them signed up; that one purchased. The
    // funnel is the one query that reads per-actor sequences rather than
    // aggregates, so it is the one most sensitive to how events are stored.
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "funnel",
        funnel: {
          steps: [{ events: ["page_view"] }, { events: ["signup"] }, { events: ["purchase"] }],
          window,
          conversionWindowMs: 7 * 24 * 60 * 60 * 1000,
          basis: "visit",
        },
      },
    });
    expect(ran.status).toBe(200);
    const steps = at(ran.body, "readout", "value", "result", "steps");
    expect(Array.isArray(steps)).toBe(true);
    expect((steps as unknown[]).map((step) => num(step, "reached"))).toEqual([VISITS, 1, 1]);
  });

  test("unsupported cohort retention is refused before execution", async () => {
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: { shape: "retention", measure: { kind: "unique", entity: "person" }, window },
    });
    expect(ran.status).toBe(400);
    expect(at(ran.body, "readout")).toBeUndefined();
    expect(at(ran.body, "code")).toBe("BAD_REQUEST");
  });
});

describe("6 · dashboard", () => {
  test("a dashboard, a tile, and real data out of it", async () => {
    const created = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/dashboards`, {
      name: `Journey board ${RUN}`,
    });
    expect(created.status).toBe(201);
    state.dashboard = str(created.body, "dashboard", "id");

    const added = await call(api, owner, "POST", `/v1/dashboards/${state.dashboard}/tiles`, {
      title: "Events this week",
      project: state.projectA,
      analysis: {
        shape: "scalar",
        measure: { kind: "count" },
        window: { kind: "relative", amount: 7, unit: "day" },
        summary: "total",
      },
      view: "number",
      width: 6,
    });
    expect(added.status).toBe(201);
    state.tile = str(added.body, "tile", "id");

    const rendered = await call(api, owner, "POST", `/v1/dashboards/${state.dashboard}/readouts`, {});
    expect(rendered.status).toBe(200);
    const readouts = at(rendered.body, "readouts") as unknown[];
    expect(readouts.length).toBe(1);
    // v1 wrapped this fan-out in `Promise.allSettled` and mapped every
    // rejection to `emptyData()`, so a broken query and a quiet project drew
    // the same chart. `ok` is the field that makes those two different.
    expect(at(readouts, 0, "ok")).toBe(true);
    expect(at(readouts, 0, "tile")).toBe(state.tile);
    expect(num(readouts, 0, "value", "value")).toBe(EVENTS);
  });
});

describe("7 · share", () => {
  test("a share link reads the dashboard it was minted for", async () => {
    const shared = await call(api, owner, "POST", `/v1/dashboards/${state.dashboard}/share`, {});
    expect(shared.status).toBe(201);
    state.shareToken = str(shared.body, "link", "token");

    const page = await call(
      api,
      anonymous(),
      "GET",
      `/v1/shared/dashboard?shareToken=${encodeURIComponent(state.shareToken)}`,
    );
    expect(page.status).toBe(200);
    expect(str(page.body, "dashboard", "id")).toBe(state.dashboard);

    const readouts = await call(
      api,
      anonymous(),
      "GET",
      `/v1/shared/readouts?shareToken=${encodeURIComponent(state.shareToken)}`,
    );
    expect(readouts.status).toBe(200);
    expect(num(readouts.body, "readouts", 0, "value", "value")).toBe(EVENTS);
  });

  test("a token cannot reach a different dashboard", async () => {
    const other = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/dashboards`, {
      name: `Journey other ${RUN}`,
    });
    state.otherDashboard = str(other.body, "dashboard", "id");
    const otherShared = await call(
      api,
      owner,
      "POST",
      `/v1/dashboards/${state.otherDashboard}/share`,
      {},
    );
    state.otherShareToken = str(otherShared.body, "link", "token");

    // Each token resolves to its own dashboard by identity, so the first one
    // can never name the second: there is no dashboard parameter to swap.
    const first = await call(
      api,
      anonymous(),
      "GET",
      `/v1/shared/dashboard?shareToken=${encodeURIComponent(state.shareToken)}`,
    );
    expect(str(first.body, "dashboard", "id")).toBe(state.dashboard);
    expect(str(first.body, "dashboard", "id")).not.toBe(state.otherDashboard);

    const second = await call(
      api,
      anonymous(),
      "GET",
      `/v1/shared/dashboard?shareToken=${encodeURIComponent(state.otherShareToken)}`,
    );
    expect(str(second.body, "dashboard", "id")).toBe(state.otherDashboard);

    // And the token authenticates nothing outside the routes that declare it:
    // `resolvePrincipal` only looks for one where the contract says a route
    // takes one, so a share token on a management route is no credential at
    // all.
    const smuggled = await call(
      api,
      anonymous(),
      "GET",
      `/v1/dashboards/${state.otherDashboard}?shareToken=${encodeURIComponent(state.shareToken)}`,
    );
    expect(smuggled.status).toBe(401);
  });

  test("a wrong token and a revoked one are the same answer", async () => {
    // 404 `NotShared` for both, deliberately. A distinct status for "that
    // token is wrong" would turn this endpoint into an oracle for which
    // dashboards have live links, which is the one thing an unauthenticated
    // route must not be.
    const nonsense = await call(api, anonymous(), "GET", `/v1/shared/dashboard?shareToken=nope-${RUN}`);
    expect(nonsense.status).toBe(404);
    expect(at(nonsense.body, "data", "reason")).toBe("NotShared");

    const unshared = await call(api, owner, "DELETE", `/v1/dashboards/${state.otherDashboard}/share`);
    expect(unshared.status).toBe(200);

    const revoked = await call(
      api,
      anonymous(),
      "GET",
      `/v1/shared/dashboard?shareToken=${encodeURIComponent(state.otherShareToken)}`,
    );
    expect(revoked.status).toBe(nonsense.status);
    expect(at(revoked.body, "data", "reason")).toBe("NotShared");
  });
});

describe("8 · authorization, negatively", () => {
  test("a service key on project A carries the issuer's holdings and no more", async () => {
    const second = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/projects`, {
      name: `Journey project B ${RUN}`,
    });
    expect(second.status).toBe(201);
    state.projectB = str(second.body, "project", "id");

    const issued = await call(api, owner, "POST", `/v1/projects/${state.projectA}/credentials`, {
      kind: "service",
      name: `journey service ${RUN}`,
    });
    expect(issued.status).toBe(201);
    serviceKey.bearer = str(issued.body, "issued", "secret");
    expect(serviceKey.bearer.startsWith("sk_")).toBe(true);

    // Q3, the grant-subset rule: an owner's service key gets what the owner
    // holds minus what is not delegable. `workspace:admin` and `billing:write`
    // are the two that never travel on a key, which is what stops a key being
    // a way to act as the workspace rather than in it.
    const permissions = at(issued.body, "issued", "credential", "permissions");
    expect(permissions).toContain("credentials:write");
    expect(permissions).toContain("projects:delete");
    expect(permissions).not.toContain("workspace:admin");
    expect(permissions).not.toContain("billing:write");
  });

  test("it reaches its own project", async () => {
    const own = await call(api, serviceKey, "GET", `/v1/projects/${state.projectA}/credentials`);
    expect(own.status).toBe(200);
  });

  test("it cannot touch project B's credentials", async () => {
    const read = await call(api, serviceKey, "GET", `/v1/projects/${state.projectB}/credentials`);
    expect(read.status).toBe(403);
    expect(at(read.body, "data", "reason")).toBe("OutOfBinding");

    const mint = await call(api, serviceKey, "POST", `/v1/projects/${state.projectB}/credentials`, {
      kind: "ingest",
      name: "escalation",
    });
    expect(mint.status).toBe(403);
    expect(at(mint.body, "data", "reason")).toBe("OutOfBinding");
  });

  test("it cannot delete a workspace-placed dashboard", async () => {
    // The key holds `dashboards:write` — the permission is not the thing that
    // stops it. The binding is: a project-scoped key reaches project-placed
    // resources, and a dashboard sits on the workspace.
    const deleted = await call(api, serviceKey, "DELETE", `/v1/dashboards/${state.otherDashboard}`);
    expect(deleted.status).toBe(403);
    expect(at(deleted.body, "data", "reason")).toBe("OutOfBinding");

    const survived = await call(api, owner, "GET", `/v1/dashboards/${state.otherDashboard}`);
    expect(survived.status).toBe(200);
  });

  test("the plan's project cap still refuses, now that the order changed", async () => {
    // The reorder that made creation work moved the cap check in front of the
    // write, so this is the assertion that it is still a check. Free is three
    // projects and the journey has made two; the third lands and the fourth is
    // refused with the limit named.
    const third = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/projects`, {
      name: `Journey project C ${RUN}`,
    });
    expect(third.status).toBe(201);

    const fourth = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/projects`, {
      name: `Journey project D ${RUN}`,
    });
    expect(fourth.status).toBe(402);
    expect(at(fourth.body, "data", "reason")).toBe("ProjectLimitReached");
    expect(num(fourth.body, "data", "limit")).toBe(3);

    // And the refusal left nothing behind — the register is the projects
    // table, so a project created and then rolled back would show up here.
    const listed = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}/projects`);
    expect((at(listed.body, "items") as unknown[]).length).toBe(3);
  });

  test("an ingest key cannot write into another project", async () => {
    // The workspace and project come from the credential, never from the body,
    // so there is no field to point at project B — which is the property
    // rather than a check. What is assertable is that the events landed under
    // A and nothing landed under B.
    const rows = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM analytics.events WHERE tenant_id = $1`,
      [state.projectB],
    );
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });
});

describe("9 · upgrade", () => {
  test("plan choices show configured prices and usage names the UTC reset", async () => {
    const plans = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}/billing/plans`);
    expect(plans.status).toBe(200);
    expect(at(plans.body, "pricing")).toBe("available");
    expect(at(plans.body, "prices")).toEqual([
      { plan: "pro", cadence: "monthly", amount: 999, currency: "usd" },
      { plan: "pro", cadence: "annual", amount: 9999, currency: "usd" },
    ]);
    const usage = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}/usage`);
    expect(usage.status).toBe(200);
    expect(str(usage.body, "usage", "period", "from")).toMatch(/-01T00:00:00.000Z$/);
    expect(str(usage.body, "usage", "period", "resetsAt")).toMatch(/-01T00:00:00.000Z$/);
    expect(Date.parse(str(usage.body, "usage", "period", "resetsAt"))).toBeGreaterThan(Date.parse(str(usage.body, "usage", "period", "measuredAt")));
  });
  test("checkout produces a hosted session at the provider", async () => {
    const checkout = await call(
      api,
      owner,
      "POST",
      `/v1/workspaces/${state.workspace}/billing/checkout`,
      {
        plan: "pro",
        cadence: "monthly",
        successUrl: "http://127.0.0.1:3000/upgraded",
        cancelUrl: "http://127.0.0.1:3000/settings",
      },
    );
    expect(checkout.status).toBe(200);
    expect(str(checkout.body, "session", "url")).toContain("checkout.stripe.test");

    const request = stripe.seen.find((seen) => seen.path === "/v1/checkout/sessions");
    expect(request).toBeDefined();
    // What the provider was actually told. `client_reference_id` and the
    // subscription metadata are how the webhook later attributes a payment to
    // a workspace; a checkout that omitted them would succeed here and produce
    // an unattributable renewal in a month.
    expect(request?.body).toContain(`client_reference_id=${state.workspace}`);
    expect(request?.body).toContain("price_journey_monthly");
    expect(request?.body).toContain("subscription_data");
  });

  test("the plan does not move until the provider says it did", async () => {
    // Counted never grants a paid entitlement from a button. The plan changes
    // on the webhook, which is why checkout returning 200 must leave the
    // workspace on free.
    const workspace = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}`);
    expect(at(workspace.body, "workspace", "plan")).toBe("free");

    const subscription = await call(
      api,
      owner,
      "GET",
      `/v1/workspaces/${state.workspace}/subscription`,
    );
    expect(subscription.status).toBe(200);
    expect(at(subscription.body, "subscription", "plan")).toBe("free");
    expect(at(subscription.body, "subscription", "hasBillingAccount")).toBe(false);
    expect(at(subscription.body, "details")).toBe(null);
    expect(at(subscription.body, "billingAvailable")).toBe(true);
  });

  test("a service key cannot start a checkout, because paying is not delegable", async () => {
    const refused = await call(
      api,
      serviceKey,
      "POST",
      `/v1/workspaces/${state.workspace}/billing/checkout`,
      {
        plan: "pro",
        cadence: "monthly",
        successUrl: "http://127.0.0.1:3000/upgraded",
        cancelUrl: "http://127.0.0.1:3000/settings",
      },
    );
    expect(refused.status).toBe(403);
  });
});

/**
 * 10 · the money path, end to end.
 *
 * Checkout is step 9 and it deliberately grants nothing. This is the half that
 * does: a signed delivery arrives, the ledger claims it, the domain transitions
 * the subscription, the workspace adopts the new standing, and the *entitlement*
 * moves — which is observable as a project the customer could not create sixty
 * lines ago.
 *
 * Three of these tests are about the delivery being refused, and they come
 * first on purpose. `POST /v1/webhooks/stripe` is a public, unauthenticated
 * endpoint whose whole job is to change what a customer is entitled to. If the
 * signature check fails open, it is a "grant me the paid plan" button that
 * anyone can press, and every happy-path test in the codebase would still pass.
 *
 * The provider is stubbed at the socket (there is no Stripe key in this
 * environment) but nothing here goes through the stub: a webhook is bytes
 * arriving at our own server, and the signature, the translation, the ledger
 * and the entitlement are all the real ones.
 */
describe("10 · webhook to entitlement", () => {
  const CUSTOMER = `cus_${RUN}`;
  const SUBSCRIPTION = `sub_${RUN}`;
  const CHECKOUT_EVENT = `evt_checkout_${RUN}`;

  const metadata = () => ({
    counted_workspace: state.workspace,
    counted_plan: "pro",
    counted_cadence: "monthly",
  });

  const checkoutBody = (id: string): string =>
    stripeEvent(id, "checkout.session.completed", {
      id: `cs_${RUN}`,
      object: "checkout.session",
      mode: "subscription",
      // Both guards the translator applies before granting anything. A
      // setup-mode session is not a subscription starting, and a session that
      // completed `unpaid` can still be declined by the bank — granting there
      // is how you comp a subscription to somebody whose card later fails.
      payment_status: "paid",
      customer: CUSTOMER,
      subscription: SUBSCRIPTION,
      client_reference_id: state.workspace,
      metadata: metadata(),
    });

  /** An invoice, at the path the 2025 API versions moved the subscription to. */
  const invoiceBody = (id: string, type: string): string =>
    stripeEvent(id, type, {
      id: `in_${id}`,
      object: "invoice",
      parent: {
        subscription_details: { subscription: SUBSCRIPTION, metadata: metadata() },
      },
    });

  const ledgerRows = async (id: string): Promise<number> => {
    const rows = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM webhook_receipts WHERE id = $1",
      [id],
    );
    return Number(rows.rows[0]?.n);
  };

  const subscriptionRow = async () => {
    const rows = await db.query<{
      plan: string;
      payment_state: string;
      customer_ref: string | null;
      subscription_ref: string | null;
      updated_at: Date;
    }>(
      `SELECT plan, payment_state, customer_ref, subscription_ref, updated_at
       FROM subscriptions WHERE workspace_id = $1`,
      [state.workspace],
    );
    return rows.rows[0] ?? null;
  };

  // ── refusals ──────────────────────────────────────────────────────────

  test("a delivery signed with the wrong secret is refused and grants nothing", async () => {
    const id = `evt_forged_${RUN}`;
    const body = checkoutBody(id);
    const refused = await deliverWebhook(
      api,
      body,
      signStripe(body, Date.now(), "whsec_attacker_guessed_this"),
    );

    expect(refused.status).toBe(400);
    expect(at(refused.body, "error")).toBe("BadSignature");
    // Never claimed. A ledger row for a forged delivery would also mean the
    // genuine one that follows it is silently swallowed as a duplicate.
    expect(await ledgerRows(id)).toBe(0);
    // Provisioning already wrote a free, unpaid subscription — `Subscription.none`
    // — so the assertion is that it is untouched, not that it is absent.
    expect((await subscriptionRow())?.plan).toBe("free");
    expect((await subscriptionRow())?.customer_ref).toBeNull();
  });

  test("a body tampered after signing is refused", async () => {
    // The whole reason the port takes raw bytes rather than a parsed object.
    const id = `evt_tampered_${RUN}`;
    const body = checkoutBody(id);
    const signature = signStripe(body);
    const tampered = body.replace(`"${state.workspace}"`, `"${state.workspace}", "x": 1`);
    expect(tampered).not.toBe(body);

    const refused = await deliverWebhook(api, tampered, signature);
    expect(refused.status).toBe(400);
    expect(await ledgerRows(id)).toBe(0);
  });

  test("a delivery with no signature header at all is refused", async () => {
    const id = `evt_unsigned_${RUN}`;
    const refused = await deliverWebhook(api, checkoutBody(id), null);
    expect(refused.status).toBe(400);
    expect(await ledgerRows(id)).toBe(0);
  });

  test("a correctly signed delivery from an hour ago is refused as stale", async () => {
    // A captured delivery replayed later. The signature is genuine, so only the
    // freshness window stands between a replay and a re-application.
    const id = `evt_stale_${RUN}`;
    const body = checkoutBody(id);
    const refused = await deliverWebhook(api, body, signStripe(body, Date.now() - 3_600_000));
    expect(refused.status).toBe(400);
    expect(at(refused.body, "error")).toBe("Stale");
    expect(await ledgerRows(id)).toBe(0);
  });

  test("nothing refused changed the workspace", async () => {
    const workspace = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}`);
    expect(at(workspace.body, "workspace", "plan")).toBe("free");
    expect(at(workspace.body, "workspace", "limits", "eventsPerMonth")).toBe(100_000);
  });

  // ── the upgrade ───────────────────────────────────────────────────────

  test("a genuine checkout completion upgrades the subscription", async () => {
    const body = checkoutBody(CHECKOUT_EVENT);
    const delivered = await deliverWebhook(api, body, signStripe(body));

    expect(delivered.status).toBe(200);
    expect(at(delivered.body, "result")).toBe("applied");

    // The row v1 never created. Its `UPDATE … WHERE user_id` matched nothing
    // for every first-time subscriber and reported success.
    const row = await subscriptionRow();
    expect(row?.plan).toBe("pro");
    expect(row?.payment_state).toBe("active");
    expect(row?.customer_ref).toBe(CUSTOMER);
    expect(row?.subscription_ref).toBe(SUBSCRIPTION);
    expect(await ledgerRows(CHECKOUT_EVENT)).toBe(1);

    const processed = await db.query<{ processed_at: Date | null }>(
      "SELECT processed_at FROM webhook_receipts WHERE id = $1",
      [CHECKOUT_EVENT],
    );
    expect(processed.rows[0]?.processed_at).not.toBeNull();
  });

  test("the workspace and its limits moved with it", async () => {
    const workspace = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}`);
    expect(at(workspace.body, "workspace", "plan")).toBe("pro");
    expect(at(workspace.body, "workspace", "payment")).toBe("active");
    expect(at(workspace.body, "workspace", "limits", "eventsPerMonth")).toBe(1_000_000);
    expect(at(workspace.body, "workspace", "limits", "projects")).toBeNull();
    expect(at(workspace.body, "workspace", "limits", "retentionDays")).toBe(730);
    expect(at(workspace.body, "workspace", "inGrace")).toBe(false);

    const subscription = await call(
      api,
      owner,
      "GET",
      `/v1/workspaces/${state.workspace}/subscription`,
    );
    expect(at(subscription.body, "subscription", "plan")).toBe("pro");
    expect(at(subscription.body, "subscription", "hasBillingAccount")).toBe(true);
    expect(at(subscription.body, "details", "cadence")).toBe("annual");
    expect(at(subscription.body, "details", "cancelAtPeriodEnd")).toBe(true);
  });

  test("usage reports the paid allowance, and the quota state with it", async () => {
    const usage = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}/usage`);
    expect(usage.status).toBe(200);
    expect(at(usage.body, "usage", "plan")).toBe("pro");
    expect(at(usage.body, "usage", "events", "limit")).toBe(1_000_000);
    // Four events against a million. The state is what the SDK and the console
    // both branch on, and it is computed rather than defaulted.
    expect(at(usage.body, "usage", "events", "state")).toBe("ok");
    expect(at(usage.body, "usage", "projects", "limit")).toBeNull();
  });

  test("the entitlement is real: a fourth project is now allowed", async () => {
    // Sixty lines ago this was 402 `ProjectLimitReached`. Nothing about the
    // request changed — only what the workspace is entitled to.
    const created = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/projects`, {
      name: `Fourth ${RUN}`,
    });
    expect(created.status).toBe(201);

    const projects = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}/projects`);
    expect(at(projects.body, "items")).toHaveLength(4);
  });

  // ── the ledger ────────────────────────────────────────────────────────

  test("a failed payment keeps the plan and puts the workspace in grace", async () => {
    const id = `evt_failed_${RUN}`;
    const body = invoiceBody(id, "invoice.payment_failed");
    const delivered = await deliverWebhook(api, body, signStripe(body));
    expect(at(delivered.body, "result")).toBe("applied");

    const workspace = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}`);
    expect(at(workspace.body, "workspace", "payment")).toBe("past_due");
    expect(at(workspace.body, "workspace", "inGrace")).toBe(true);
    // Still Pro's limits. Dropping a paying customer to free the instant a card
    // expires is a worse failure than carrying them for a cycle.
    expect(at(workspace.body, "workspace", "limits", "eventsPerMonth")).toBe(1_000_000);
  });

  test("redelivering the checkout event does not re-apply it", async () => {
    // Stripe delivers at-least-once and retries for three days. The workspace
    // is `past_due` right now, so a second application of the original
    // `checkout.session.completed` would flip it back to `active` — which is
    // exactly the invisible corruption the ledger exists to prevent, and it is
    // visible here because the state moved on in between.
    const body = checkoutBody(CHECKOUT_EVENT);
    const redelivered = await deliverWebhook(api, body, signStripe(body));

    expect(redelivered.status).toBe(200);
    expect(at(redelivered.body, "result")).toBe("duplicate");
    expect(await ledgerRows(CHECKOUT_EVENT)).toBe(1);
    expect((await subscriptionRow())?.payment_state).toBe("past_due");
  });

  test("a recovered payment takes the workspace back out of grace", async () => {
    const id = `evt_paid_${RUN}`;
    const body = invoiceBody(id, "invoice.paid");
    expect(at((await deliverWebhook(api, body, signStripe(body))).body, "result")).toBe("applied");

    const workspace = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}`);
    expect(at(workspace.body, "workspace", "payment")).toBe("active");
    expect(at(workspace.body, "workspace", "inGrace")).toBe(false);
  });

  test("an event we do not act on is acknowledged, not retried into the ground", async () => {
    // Stripe retries a non-2xx for three days. An endpoint that errors on the
    // types it does not handle spends those days being hammered while the ones
    // it does handle queue up behind them.
    const id = `evt_upcoming_${RUN}`;
    const body = stripeEvent(id, "invoice.upcoming", { id: `in_${id}`, object: "invoice" });
    const delivered = await deliverWebhook(api, body, signStripe(body));
    expect(delivered.status).toBe(200);
    expect(at(delivered.body, "result")).toBe("ignored");
  });

  test("a cancellation returns the entitlement to free without erasing the plan", async () => {
    const id = `evt_canceled_${RUN}`;
    const body = stripeEvent(id, "customer.subscription.deleted", {
      id: SUBSCRIPTION,
      object: "subscription",
      status: "canceled",
      customer: CUSTOMER,
      metadata: metadata(),
    });
    expect(at((await deliverWebhook(api, body, signStripe(body))).body, "result")).toBe("applied");

    const workspace = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}`);
    // Workspace views expose the effective plan, consistently with their
    // limits. The subscription keeps the purchased plan for billing history.
    expect(at(workspace.body, "workspace", "plan")).toBe("free");
    expect(at(workspace.body, "workspace", "payment")).toBe("canceled");
    expect(at(workspace.body, "workspace", "limits", "eventsPerMonth")).toBe(100_000);
    expect(at(workspace.body, "workspace", "limits", "projects")).toBe(3);
    expect(at(workspace.body, "workspace", "inGrace")).toBe(false);

    expect((await subscriptionRow())?.plan).toBe("pro");

    const usage = await call(api, owner, "GET", `/v1/workspaces/${state.workspace}/usage`);
    expect(at(usage.body, "usage", "plan")).toBe("free");
    // Four projects against a cap of three: over it, which is a fact the
    // downgrade prompt needs and not a refusal of anything already created.
    expect(at(usage.body, "usage", "projects", "used")).toBe(4);
    expect(at(usage.body, "usage", "projects", "limit")).toBe(3);
  });
});

/**
 * 11 · country — the one dimension Counted works out rather than being told.
 *
 * Last, deliberately: it adds events to project A, and every count this suite
 * asserted earlier is already asserted. Adding it anywhere else would make
 * `EVENTS` wrong somewhere and the failure would look like a bug in ingest.
 *
 * The API is spawned with the default one trusted proxy hop and nothing sits in
 * front of it here, so the header this test sends IS the one the edge would
 * have appended. That is the same configuration a deployment has and the reason
 * `client-ip.test.ts` exists separately: the spoofing case needs a second entry
 * in the list, which only a real proxy produces.
 */
describe("11 · country", () => {
  const from = (address: string) => ({ "x-forwarded-for": address });

  /** Google's 8.8.8.0/24 (US) and a RIPE block registered in France. */
  const AMERICAN = "8.8.8.8";
  const FRENCH = "213.32.1.1";

  const geoEvent = (visit: string) => ({
    name: "geo_view",
    visitId: `${RUN}-geo-${visit}`,
    occurredAt: new Date().toISOString(),
    idempotencyKey: `${RUN}-geo-${visit}`,
    systemProperties: { os_name: "macOS", country: "ZW" },
  });

  test("two batches from two countries are accepted", async () => {
    const one = await call(api, ingestKey, "POST", "/v1/events", {
      events: [geoEvent("us1"), geoEvent("us2")],
    }, from(AMERICAN));
    expect(one.status).toBe(202);
    expect(num(one.body, "accepted")).toBe(2);

    const two = await call(api, ingestKey, "POST", "/v1/events", {
      events: [geoEvent("fr1")],
    }, from(FRENCH));
    expect(two.status).toBe(202);
    expect(num(two.body, "accepted")).toBe(1);
  });

  test("the country column holds the derived code, not the one the client sent", async () => {
    // Every one of those events carried `country: "ZW"` in its
    // systemProperties. If a client could set this field it could put its
    // traffic anywhere on the map — and the chart would look entirely normal.
    const rows = await db.query<{ value: string; n: string }>(
      `SELECT d.value AS value, count(*)::text AS n
         FROM analytics.events e
         JOIN analytics.dims d ON d.dim = 'country' AND d.id = e.country
        WHERE e.tenant_id = $1 AND e.event_type = (
                SELECT id FROM analytics.dims WHERE dim = 'events.event_type' AND value = 'geo_view')
        GROUP BY d.value ORDER BY d.value`,
      [state.projectA],
    );
    expect(rows.rows.map((row) => [row.value, Number(row.n)])).toEqual([
      ["FR", 1],
      ["US", 2],
    ]);
  });

  test("no address reached the database, in any column", async () => {
    // The claim the whole design rests on. `props` is the open jsonb bag and is
    // the only place a string could have hidden.
    const leaked = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM analytics.events
        WHERE tenant_id = $1 AND (props::text LIKE $2 OR props::text LIKE $3)`,
      [state.projectA, `%${AMERICAN}%`, `%${FRENCH}%`],
    );
    expect(Number(leaked.rows[0]?.n)).toBe(0);

    // And the dictionary, which is where a dimension's values live. Two letters
    // each, and nothing that parses as an address.
    const dims = await db.query<{ value: string }>(
      `SELECT value FROM analytics.dims WHERE dim = 'country'`,
    );
    expect(dims.rows.length).toBeGreaterThan(0);
    for (const row of dims.rows) expect(row.value).toMatch(/^[A-Z]{2}$/);
  });

  test("country filters a query, over a real segment", async () => {
    await flushSegments(db);
    const window = { kind: "relative" as const, amount: 7, unit: "day" as const };

    const american = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "scalar",
        measure: { kind: "count" },
        where: {
          op: "and",
          operands: [
            { op: "eq", field: { source: "dimension", key: "country" }, value: "US" },
            { op: "eq", field: { source: "dimension", key: "event_type" }, value: "geo_view" },
          ],
        },
        window,
        summary: "total",
      },
    });
    expect(american.status).toBe(200);
    expect(num(american.body, "readout", "value", "value")).toBe(2);
  });

  test("country groups a breakdown, which is the slice this was all for", async () => {
    const window = { kind: "relative" as const, amount: 7, unit: "day" as const };
    const ran = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, {
      analysis: {
        shape: "breakdown",
        measure: { kind: "count" },
        by: { source: "dimension", key: "country" },
        where: { op: "eq", field: { source: "dimension", key: "event_type" }, value: "geo_view" },
        window,
        order: "desc",
        limit: 10,
      },
    });
    expect(ran.status).toBe(200);
    const rows = at(ran.body, "readout", "value", "rows");
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toEqual([
      { label: "US", value: 2 },
      { label: "FR", value: 1 },
    ]);
  });

  test("a caller the locator cannot place still lands, with no country", async () => {
    // A private range: nobody has been delegated it, so there is no country and
    // saying so is the right answer. The event must not be lost over it.
    const posted = await call(api, ingestKey, "POST", "/v1/events", {
      events: [geoEvent("private")],
    }, from("10.0.0.1"));
    expect(posted.status).toBe(202);

    // NULL in staging. The 0 sentinel is a *summary* thing: the marginal for
    // `country` rolls nulls up under value 0, and the catalog's join to `dims`
    // then drops them — so an event we could not place is absent from the
    // breakdown above rather than a bucket called "unknown".
    const raw = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM analytics.events
        WHERE tenant_id = $1 AND country IS NULL
          AND event_type = (SELECT id FROM analytics.dims
                             WHERE dim = 'events.event_type' AND value = 'geo_view')`,
      [state.projectA],
    );
    expect(Number(raw.rows[0]?.n)).toBe(1);

    await flushSegments(db);
    const summarised = await db.query<{ n: string }>(
      `SELECT coalesce(sum(n), 0)::text AS n FROM analytics.events_summary_dims
        WHERE tenant_id = $1 AND dim = $2 AND value = 0`,
      [state.projectA, dimensionOrdinal("country")],
    );
    expect(Number(summarised.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});

describe("12 · retention purge", () => {
  /**
   * The promise on the pricing page, exercised end to end: a project's events
   * before an instant are deleted from staging and from the packed segments,
   * a query on that project answers zero afterwards, the neighbouring project
   * is untouched, and a second purge finds nothing. Driven through the same
   * adapter the worker's retention sweep uses, on project B — which has no
   * events until now, and is the second of the two projects the free plan
   * allows — so the cutoff can be "now" without any plan arithmetic in the way.
   */
  const windowOf = { kind: "relative" as const, amount: 7, unit: "day" as const };
  const bKey: Caller = anonymous();
  let countA = 0;

  const countOf = async (project: string): Promise<number> => {
    const ran = await call(api, owner, "POST", `/v1/projects/${project}/queries`, {
      analysis: { shape: "scalar", measure: { kind: "count" }, window: windowOf, summary: "total" },
    });
    expect(ran.status).toBe(200);
    return num(ran.body, "readout", "value", "value");
  };

  test("project B takes two events, packed", async () => {
    const issued = await call(api, owner, "POST", `/v1/projects/${state.projectB}/credentials`, {
      kind: "ingest",
      name: `journey B ${RUN}`,
    });
    expect(issued.status).toBe(201);
    bKey.bearer = str(issued.body, "issued", "secret");

    const now = Date.now() - 5_000;
    const posted = await call(api, bKey, "POST", "/v1/events", {
      events: [1, 2].map((i) => ({
        name: "purge_me",
        visitId: `${RUN}-b${i}`,
        occurredAt: new Date(now + i * 1_000).toISOString(),
        idempotencyKey: `${RUN}-purge-${i}`,
        properties: {},
      })),
    });
    expect(posted.status).toBe(202);
    await flushSegments(db);
    expect(await countOf(state.projectB)).toBe(2);
    countA = await countOf(state.projectA);
    expect(countA).toBeGreaterThan(0);
  });

  test("purging before now deletes exactly those events and reports the count", async () => {
    const retention = new LiticsEventRetention({ pool: db });
    const before = Instant.fromDate(new Date(Date.now() + 1_000));
    const purged = await retention.purge({ project: ProjectId(state.projectB), before });
    expect(purged).toEqual({ ok: true, value: 2 });
    expect(await countOf(state.projectB)).toBe(0);
    const left = await db.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM analytics.events WHERE tenant_id = $1)
            + (SELECT coalesce(sum(n), 0) FROM analytics.events_segments WHERE tenant_id = $1) AS n`,
      [state.projectB],
    );
    expect(Number(left.rows[0]?.n)).toBe(0);
  });

  test("the neighbouring project is untouched, and a second purge finds nothing", async () => {
    expect(await countOf(state.projectA)).toBe(countA);
    const retention = new LiticsEventRetention({ pool: db });
    const again = await retention.purge({ project: ProjectId(state.projectB), before: Instant.fromDate(new Date(Date.now() + 1_000)) });
    expect(again).toEqual({ ok: true, value: 0 });
  });
});

describe("13 · an agent, over MCP", () => {
  /**
   * The Phase 7 exit condition: an agent holding nothing but a key can do
   * over MCP what a person does in the console — and no more, decided by the
   * same code. The MCP server is started the way a deployment starts it
   * (`bun apps/mcp/src/main.ts`), pointed at this journey's API, and driven
   * with the reference client library over Streamable HTTP. Nothing between
   * the two is faked: a tool call becomes an HTTP request the API authorizes
   * with `packages/authorization`, exactly as the console's would be, and
   * every number below is read back from a real segment.
   *
   * The key is a workspace-wide service key, issued by the owner over HTTP —
   * the one route that mints such a key is deliberately not a tool. Not the
   * project-scoped key from section 8: a dashboard sits on the workspace and
   * a project-bound key cannot reach it, which the last test proves through
   * MCP as the same `OutOfBinding` the API answers over HTTP.
   */
  let mcp: Mcp;
  let agent: Agent;
  const agentKey: Caller = anonymous();
  const built = { provisioned: "", claimToken: "", dashboard: "", tile: "" };
  const analysis = {
    shape: "scalar",
    measure: { kind: "count" },
    window: { kind: "relative", amount: 7, unit: "day" },
    summary: "total",
  };
  const rpc = (bearer: string | null) =>
    fetch(mcp.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

  beforeAll(async () => {
    mcp = await startMcp(api);
  });

  afterAll(async () => {
    await agent?.close();
    await mcp?.stop();
  });

  test("the owner hands the agent a workspace-wide service key", async () => {
    const issued = await call(api, owner, "POST", `/v1/workspaces/${state.workspace}/credentials`, {
      name: `journey agent ${RUN}`,
    });
    expect(issued.status).toBe(201);
    agentKey.bearer = str(issued.body, "issued", "secret");
    expect(agentKey.bearer.startsWith("sk_")).toBe(true);
    expect(at(issued.body, "issued", "credential", "project")).toBeNull();
    expect(at(issued.body, "issued", "credential", "workspace")).toBe(state.workspace);
  });

  test("a request with no bearer is refused with the challenge that starts OAuth", async () => {
    const bare = await rpc(null);
    expect(bare.status).toBe(401);
    const challenge = bare.headers.get("www-authenticate") ?? "";
    expect(challenge.startsWith("Bearer ")).toBe(true);
    expect(challenge).toContain(
      `resource_metadata="${mcp.origin}/.well-known/oauth-protected-resource/mcp"`,
    );

    // The document the challenge points at names this server as the resource
    // and the API as the authorization server — the two facts a client needs
    // to go and get a token.
    const metadata = await fetch(`${mcp.origin}/.well-known/oauth-protected-resource/mcp`);
    expect(metadata.status).toBe(200);
    const document = await metadata.json();
    expect(document).toEqual({
      resource: mcp.endpoint,
      authorization_servers: [`${api.origin}/api/auth`],
      bearer_methods_supported: ["header"],
      scopes_supported: expect.arrayContaining(["workspace:read", "projects:write", "queries:run", "events:write"]),
    });
    expect(document.scopes_supported).not.toContain("workspace:admin");
    expect(document.scopes_supported).not.toContain("billing:write");

    // The reference client meets the same 401 and reports it as the one typed
    // error an authorization flow starts from.
    let failure: unknown = null;
    try {
      await connectAgent(mcp, null);
    } catch (cause) {
      failure = cause;
    }
    expect(isUnauthorized(failure)).toBe(true);
  });

  test("a key the API does not know is refused as invalid_token — the API decided, not this server", async () => {
    const forged = await rpc(`sk_journey_forgery_${RUN}`);
    expect(forged.status).toBe(401);
    expect(forged.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("the agent is offered every exposed tool and none of the withheld ones", async () => {
    agent = await connectAgent(mcp, agentKey.bearer);
    const names = (await agent.tools()).map((tool) => tool.name);

    // The ones the rest of this section drives, by name.
    for (const name of [
      "projects_provision",
      "projects_claim",
      "projects_create",
      "dashboards_create",
      "tiles_add",
      "dashboards_readouts",
      "queries_run",
      "queries_schema",
    ]) {
      expect(names).toContain(name);
    }
    // The ones the exposure table withholds, by name.
    for (const name of [
      "credentials_revoke",
      "credentials_issue_for_workspace",
      "projects_delete",
      "dashboards_delete",
      "billing_checkout",
      "workspaces_members",
    ]) {
      expect(names).not.toContain(name);
    }
    // And the whole table, so a tool cannot be added or dropped without this
    // noticing: the offered set is exactly the exposed set, derived the same way.
    expect([...names].sort()).toEqual(EXPOSED.map((exposure) => toolNameOf(exposure.id)).sort());
    for (const withheld of WITHHELD) expect(names).not.toContain(toolNameOf(withheld.id));
  });

  test("every tool runs as the key: the agent is the account that issued it", async () => {
    const me = await agent.call("account_me");
    expect(me.ok, me.text).toBe(true);
    expect(str(me.body, "account", "id")).toBe(state.account);
    const workspaces = (at(me.body, "workspaces") as unknown[]).map((w) => at(w, "id"));
    expect(workspaces).toContain(state.workspace);
  });

  test("the agent provisions a project with no credential, and is refused the claim by the plan's cap", async () => {
    const provisioned = await agent.call("projects_provision", { name: `Agent project ${RUN}` });
    expect(provisioned.ok, provisioned.text).toBe(true);
    built.provisioned = str(provisioned.body, "project", "id");
    expect(at(provisioned.body, "project", "workspace")).toBeNull();
    expect(str(provisioned.body, "credential", "secret").startsWith("ck_")).toBe(true);
    built.claimToken = str(provisioned.body, "claim", "token");

    // The workspace holds four projects against a cap of three — section 10
    // upgraded it and then cancelled. The refusal arrives as a tool result the
    // agent can read, with the limit named, not as a protocol error the client
    // library would have handled before the model ever saw it.
    const refused = await agent.call("projects_claim", {
      projectId: built.provisioned,
      workspaceId: state.workspace,
      claimToken: built.claimToken,
    });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain("PAYMENT_REQUIRED");
    expect(refused.text).toContain("ProjectLimitReached");
  });

  test("archiving over MCP frees a slot", async () => {
    // `POST /v1/projects/{id}/archive` archives the row and then releases the
    // slot through the workspace, whose project register is loaded from the
    // `projects` table — which already shows the row archived. The router
    // treats the register's "already archived" as the slot being free, which
    // it is; this used to surface as a 409 after a successful archive.
    const archived = await agent.call("projects_archive", { projectId: state.projectB });
    expect(archived.ok, archived.text).toBe(true);
    expect(at(archived.body, "project", "archived")).toBe(true);
  });

  test("the owner makes room — deleting is not a tool — and the agent's claim lands", async () => {
    // Four projects against a cap of three: the archive above frees one slot
    // and two more have to go. `projects.delete` is withheld from agents on purpose, so the
    // irreversible half is the person's, over HTTP: two projects the journey
    // has no further use for.
    const listed = await agent.call("projects_list", { workspaceId: state.workspace });
    expect(listed.ok, listed.text).toBe(true);
    const items = at(listed.body, "items") as unknown[];
    const spare = items.filter((item) =>
      [`Journey project C ${RUN}`, `Fourth ${RUN}`].includes(str(item, "name")),
    );
    expect(spare.length).toBe(2);
    for (const project of spare) {
      const deleted = await call(api, owner, "DELETE", `/v1/projects/${str(project, "id")}`);
      expect(deleted.status).toBe(200);
      expect(at(deleted.body, "deleted")).toBe(true);
    }

    // And the agent may not do what the person just did, by any name.
    expect((await agent.tools()).map((tool) => tool.name)).not.toContain("projects_delete");

    const claimed = await agent.call("projects_claim", {
      projectId: built.provisioned,
      workspaceId: state.workspace,
      claimToken: built.claimToken,
    });
    expect(claimed.ok, claimed.text).toBe(true);
    expect(str(claimed.body, "project", "workspace")).toBe(state.workspace);

    // The same grant a second time is spent: the claim is not replayable.
    const again = await agent.call("projects_claim", {
      projectId: built.provisioned,
      workspaceId: state.workspace,
      claimToken: built.claimToken,
    });
    expect(again.ok).toBe(false);

    // Placed in the tenancy tree, which is what makes it queryable at all.
    const rows = await db.query<{ depth: number }>(
      `SELECT depth FROM analytics.org_tree WHERE ancestor = $1 AND descendant = $2`,
      [state.workspace, built.provisioned],
    );
    expect(rows.rows[0]?.depth).toBe(1);
  });

  test("a dashboard, a tile and a readout, all over MCP", async () => {
    const created = await agent.call("dashboards_create", {
      workspaceId: state.workspace,
      name: `Agent board ${RUN}`,
    });
    expect(created.ok, created.text).toBe(true);
    built.dashboard = str(created.body, "dashboard", "id");

    const added = await agent.call("tiles_add", {
      dashboardId: built.dashboard,
      title: "Events this week",
      project: state.projectA,
      analysis,
      view: "number",
      width: 6,
    });
    expect(added.ok, added.text).toBe(true);
    built.tile = str(added.body, "tile", "id");

    const rendered = await agent.call("dashboards_readouts", { dashboardId: built.dashboard });
    expect(rendered.ok, rendered.text).toBe(true);
    const readouts = at(rendered.body, "readouts") as unknown[];
    expect(readouts.length).toBe(1);
    expect(at(readouts, 0, "ok")).toBe(true);
    expect(at(readouts, 0, "tile")).toBe(built.tile);
    const onTile = num(readouts, 0, "value", "value");
    expect(onTile).toBeGreaterThanOrEqual(0);

    // The same question asked directly answers the same number, and a person
    // asking it over HTTP reads that number too: one engine, three doors.
    const ran = await agent.call("queries_run", { projectId: state.projectA, analysis });
    expect(ran.ok, ran.text).toBe(true);
    expect(num(ran.body, "readout", "value", "value")).toBe(onTile);
    const byHand = await call(api, owner, "POST", `/v1/projects/${state.projectA}/queries`, { analysis });
    expect(byHand.status).toBe(200);
    expect(num(byHand.body, "readout", "value", "value")).toBe(onTile);

    // The project the agent just claimed has nothing in it yet, and says so
    // as a number rather than as an error.
    const empty = await agent.call("queries_run", { projectId: built.provisioned, analysis });
    expect(empty.ok, empty.text).toBe(true);
    expect(num(empty.body, "readout", "value", "value")).toBe(0);

    // The instructions tell an agent to read the schema before writing an
    // analysis; here is the schema, with the events section 4 sent.
    const schema = await agent.call("queries_schema", { projectId: state.projectA });
    expect(schema.ok, schema.text).toBe(true);
    expect(at(schema.body, "schema", "events")).toContain("page_view");
  });

  test("a withheld tool cannot be called by name either", async () => {
    // Not a refusal — the tool does not exist on this server, so the client
    // library surfaces the protocol error. Nothing reached the API.
    await expect(agent.call("credentials_revoke", { credentialId: "cred_x" })).rejects.toThrow(
      /credentials_revoke/,
    );
  });

  test("a project-scoped key is refused by the API, not by this server", async () => {
    const narrow = await connectAgent(mcp, serviceKey.bearer);
    try {
      // Offered exactly the same tools: the server does not know what a key
      // may do, so it cannot narrow the list.
      const offered = (await narrow.tools()).map((tool) => tool.name).sort();
      expect(offered).toEqual((await agent.tools()).map((tool) => tool.name).sort());

      // A dashboard sits on the workspace; this key is bound to project A. The
      // refusal is the API's — the same reason section 8 read over HTTP.
      const refused = await narrow.call("dashboards_create", {
        workspaceId: state.workspace,
        name: "escalation",
      });
      expect(refused.ok).toBe(false);
      expect(refused.text).toContain("FORBIDDEN");
      expect(refused.text).toContain("OutOfBinding");
      expect(refused.text).toContain("Retrying will not help");

      // Its own project it still reaches, and reads the same number.
      const own = await narrow.call("queries_run", { projectId: state.projectA, analysis });
      expect(own.ok, own.text).toBe(true);
      const theirs = await agent.call("queries_run", { projectId: state.projectA, analysis });
      expect(num(own.body, "readout", "value", "value")).toBe(num(theirs.body, "readout", "value", "value"));
    } finally {
      await narrow.close();
    }
  });
});
