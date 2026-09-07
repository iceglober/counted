/**
 * The transport, end to end, over in-memory ports.
 *
 * This is the test that proves the pieces are wired to each other rather than
 * merely to their own unit tests: a real `Request` goes in, the authorization
 * middleware runs, a handler answers, and the response comes back through
 * oRPC's OpenAPI codec. Nothing here needs a database or a clock that ticks.
 *
 * The route-ordering assertions matter most. The three hand-written routes are
 * registered before the oRPC catch-all, so a mistake there is a documented
 * procedure that silently answers something else — and `matched` is what turns
 * an unrecognised path into our 404 rather than oRPC's.
 */

import { describe, expect, test } from "bun:test";
import { Instant, type AccountId, type WorkspaceId } from "@counted/kernel";
import { Workspace } from "@counted/tenancy-domain";
import { permissionsForRole } from "@counted/authorization";
import { createServer } from "./server";
import { authorizeDeps } from "./index";
import { HEALTH_PATH, READY_PATH } from "./health";
import { TRACE_HEADER } from "./tracing";
import { absent, countingIds, frozenClock, fixedGeo, testDependencies } from "./testing";
import type { ApiDependencies } from "./deps";

const AT = Instant.fromEpochMillis(1_700_000_000_000);
const WS = "ws_1" as WorkspaceId;
const ACCOUNT = "acct_1" as AccountId;

const workspace = (): Workspace => {
  const opened = Workspace.open(WS, "Acme", ACCOUNT, AT);
  if (!opened.ok) throw new Error("unreachable: a named workspace opens");
  return opened.value.workspace;
};

const dependencies = (overrides: Partial<ApiDependencies> = {}): ApiDependencies =>
  testDependencies({
    clock: frozenClock(AT),
    ids: countingIds("trace"),
    reads: {
      ...testDependencies().reads,
      workspaces: {
        find: async (id) => (id === WS ? workspace() : null),
        listForAccount: async () => [{ id: WS, name: "Acme", role: "owner" }],
        save: async () => {},
      },
    } as ApiDependencies["reads"],
    identity: {
      ...testDependencies().identity,
      memberships: {
        roleOf: async (_account, id) => (id === WS ? "owner" : null),
        membersOf: async () => [],
        // The writes have their own test file; nothing here should reach them.
        changeRole: async () => absent("MembershipWriter", "changeRole"),
        remove: async () => absent("MembershipWriter", "remove"),
      },
    http: {
      oauthPrincipal: async () => null,
        handle: async () => new Response(JSON.stringify({ auth: true }), { status: 200 }),
        principal: async (headers) =>
          headers.get("cookie") === "session=good"
            ? { account: ACCOUNT, email: "a@b.co", emailVerified: true, activeWorkspace: WS, expiresAt: AT }
            : null,
      },
    } as ApiDependencies["identity"],
    ...overrides,
  });

const build = (
  overrides: Partial<ApiDependencies> = {},
  readiness?: () => Promise<{ ready: boolean; detail: string }>,
) => {
  const deps = dependencies(overrides);
  return createServer({
    deps,
    authorize: authorizeDeps(deps),
    ingest: {
      credentials: deps.identity.credentials,
      commit: { submit: async () => ({ kind: "Committed", accepted: 0, deduplicated: 0, rejected: [], commit: null }) } as never,
      projectWorkspace: async () => WS,
      logger: deps.logger,
      maxBodyBytes: 1000,
      geo: fixedGeo(),
      trustedProxyHops: 1,
    },
    webhook: null,
    mintTraceId: () => "trace-fixed",
    ...(readiness === undefined ? {} : { readiness }),
  });
};

const get = (path: string, headers: Record<string, string> = {}) =>
  build().request(`http://api.test${path}`, { headers });

describe("/health", () => {
  test("answers at /health and nowhere else", async () => {
    const ok = await get(HEALTH_PATH);
    expect(ok.status).toBe(200);
    // `release` is on both health bodies so which build is serving is a curl
    // — the deploy sets it, and a rollback is confirmed by reading it back.
    expect(await ok.json()).toMatchObject({
      status: "ok",
      service: "counted-api-test",
      release: "test-release",
    });

    // The deployed v2 answered `/health` while its Railway check pointed at
    // `/v1/health`, which 404'd — so every deploy waited out the check's
    // timeout and a broken instance looked exactly like a working one.
    const wrong = await get("/v1/health");
    expect(wrong.status).toBe(404);
  });

  test("needs no credential", async () => {
    expect((await get(HEALTH_PATH)).status).toBe(200);
  });

  /**
   * `deploy/api.railway.json` points its health check at `/health/ready`. The
   * two agreeing is the whole reason both paths exist here — v2's check pointed
   * at a path the server did not serve, so every deploy waited out its timeout.
   */
  test("readiness answers at the path the deploy config names", async () => {
    const ready = await build({}, async () => ({ ready: true, detail: "schema current" })).request(
      `http://api.test${READY_PATH}`,
    );
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: "ready",
      detail: "schema current",
      release: "test-release",
    });
  });

  /**
   * 503 rather than 500, so the platform keeps the previous replica serving
   * instead of restarting this one — a replica built against a different schema
   * is not broken, it is just not the one that should take traffic.
   */
  test("a replica that is not ready answers 503 and says why", async () => {
    const notReady = await build({}, async () => ({ ready: false, detail: "schema is behind" })).request(
      `http://api.test${READY_PATH}`,
    );
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({ status: "not_ready", detail: "schema is behind" });
  });

  test("a readiness probe that throws is not-ready, not a 500", async () => {
    const thrown = await build({}, async () => {
      throw new Error("connection refused");
    }).request(`http://api.test${READY_PATH}`);
    expect(thrown.status).toBe(503);
    expect(await thrown.json()).toMatchObject({ detail: "connection refused" });
  });
});

describe("the catch-all", () => {
  test("an unmatched path is our 404, not oRPC's", async () => {
    const response = await get("/v1/nothing-here");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found", path: "/v1/nothing-here" });
  });

  test("every response carries the trace id, including the failures", async () => {
    const missing = await get("/v1/nothing-here");
    expect(missing.headers.get(TRACE_HEADER)).toBe("trace-fixed");

    const found = await get(HEALTH_PATH);
    expect(found.headers.get(TRACE_HEADER)).toBe("trace-fixed");
  });

  test("an inbound traceparent is propagated back out", async () => {
    const response = await build().request("http://api.test/health", {
      headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
    });
    expect(response.headers.get(TRACE_HEADER)).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});

describe("a contract route, through the whole stack", () => {
  test("a signed-in owner reads their workspace", async () => {
    const response = await get("/v1/workspaces/ws_1", { cookie: "session=good" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workspace: { id: "ws_1", name: "Acme", plan: "free", payment: "none", inGrace: false },
    });
  });

  test("no credential is a 401 with no detail", async () => {
    const response = await get("/v1/workspaces/ws_1");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "UNAUTHORIZED",
      data: { reason: "NotAuthenticated" },
    });
  });

  test("a workspace that does not exist is a 404 with the reason", async () => {
    const response = await get("/v1/workspaces/ws_nope", { cookie: "session=good" });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ data: { reason: "NoSuchWorkspace" } });
  });

  test("a listing route returns what the caller reaches", async () => {
    const response = await get("/v1/workspaces", { cookie: "session=good" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [{ id: "ws_1", name: "Acme", role: "owner", permissions: permissionsForRole("owner") }],
    });
  });
});

describe("the hand-written routes", () => {
  test("the auth provider's own router is reachable", async () => {
    const response = await build().request("http://api.test/api/auth/session");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ auth: true });
  });

  /**
   * The identity adapter nails two families shut: key CRUD, and organization
   * create/delete. They answer 404 rather than 403 — a 403 confirms the
   * endpoint exists and the caller merely lacks permission, which is an
   * invitation to keep trying.
   */
  test("the blocked auth routes are 404, not 403", async () => {
    for (const path of ["/api/auth/api-key/list", "/api/auth/organization/create"]) {
      const response = await build().request(`http://api.test${path}`, { method: "POST" });
      expect(response.status).toBe(404);
    }
  });

  /**
   * The console draws a button per name here, so a provider that is listed and
   * not configured is a button that fails after the redirect — and one that is
   * configured and not listed is a provider nobody can reach.
   */
  test("the social providers on offer are the ones configured, and no more", async () => {
    const none = await build().request("http://api.test/api/auth/providers");
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ providers: [] });

    const configured = build({
      config: {
        ...dependencies().config,
        social: {
          github: { clientId: "id", clientSecret: "secret" },
          google: null,
        },
      },
    });
    expect(await (await configured.request("http://api.test/api/auth/providers")).json()).toEqual({
      providers: ["github"],
    });
  });

  test("ingest answers on POST and preflights on OPTIONS", async () => {
    const preflight = await build().request("http://api.test/v1/events", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const post = await build().request("http://api.test/v1/events", {
      method: "POST",
      body: JSON.stringify({ events: [] }),
    });
    expect(post.status).toBe(401);
    expect(post.headers.get("access-control-allow-origin")).toBe("*");
  });

  /**
   * The webhook is not mounted when no payment provider is configured. An
   * endpoint that 500s on every delivery would make Stripe retry for three
   * days; a 404 makes it give up, which is the truth about this deployment.
   */
  test("the Stripe webhook is absent when billing is not configured", async () => {
    const response = await build().request("http://api.test/v1/webhooks/stripe", { method: "POST" });
    expect(response.status).toBe(404);
  });
});

describe("errors that escape a handler", () => {
  test("an unhandled throw is a 500 that leaks nothing, and is logged once", async () => {
    const lines: string[] = [];
    const deps = dependencies({
      logger: {
        debug: () => {}, info: () => {}, warn: () => {},
        error: (message, fields) => lines.push(`${message}:${JSON.stringify(fields ?? {})}`),
        with: () => deps.logger,
      },
      reads: {
        ...dependencies().reads,
        workspaces: {
          find: async () => {
            throw new Error("connection to 10.0.0.4 failed: SELECT * FROM workspaces WHERE id = 'ws_1'");
          },
          listForAccount: async () => [],
          save: async () => {},
        },
      } as ApiDependencies["reads"],
    });

    const app = createServer({
      deps,
      authorize: authorizeDeps(deps),
      ingest: {
        credentials: deps.identity.credentials,
        commit: { submit: async () => ({ kind: "Committed", accepted: 0, deduplicated: 0, rejected: [], commit: null }) } as never,
        projectWorkspace: async () => WS,
        logger: deps.logger,
        maxBodyBytes: 1000,
        geo: fixedGeo(),
        trustedProxyHops: 1,
      },
      webhook: null,
      mintTraceId: () => "trace-fixed",
    });

    const response = await app.request("http://api.test/v1/workspaces/ws_1", {
      headers: { cookie: "session=good" },
    });
    expect(response.status).toBe(500);

    const body = await response.text();
    // A driver's message routinely contains the failing statement and its
    // parameters. None of it reaches the caller — oRPC answers a bare
    // "Internal Server Error" and the trace id travels in the header.
    expect(body).not.toContain("SELECT");
    expect(body).not.toContain("10.0.0.4");
    expect(response.headers.get(TRACE_HEADER)).toBe("trace-fixed");

    // ...and it is not silent. oRPC catches the throw itself, so without an
    // interceptor a driver failure inside any of the 53 procedures would be a
    // 500 nobody ever saw.
    expect(lines.some((line) => line.startsWith("handler threw:"))).toBe(true);
    expect(lines.join()).toContain("workspaces.get");
  });
});
