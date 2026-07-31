/**
 * The guard, over stub ports.
 *
 * These assert the HTTP consequences of a decision — status, headers, and how
 * much the response is willing to say. The rules themselves are tested
 * exhaustively in the domain, with no HTTP anywhere near them.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { Instant, Principal, ProjectId, WorkspaceId, type Placement } from "@counted/domain";
import type { ApiEnv } from "../server";
import { createGuard } from "./guard";
import { mount, projectFromPath, publicRoute, requires, type RouteDefinition } from "./route";
import { stubAccess } from "../server.test";

const ws = WorkspaceId("ws_1");
const prj = ProjectId("prj_1");
const placement: Placement = { workspace: ws, project: prj };

const serviceKey: Principal = {
  kind: "service",
  credential: "cred_1" as never,
  workspace: ws,
  projects: "all",
  scopes: ["queries:run"],
  onBehalfOf: "acc_1" as never,
};

const app = (over: Parameters<typeof stubAccess>[0] = {}) => {
  const routes: readonly RouteDefinition[] = [
    {
      method: "get",
      path: "/open",
      security: publicRoute("a test route"),
      handler: (c) => c.json({ saw: c.get("principal").kind }),
    },
    {
      method: "get",
      path: "/p/:projectId",
      security: requires("queries:run", projectFromPath()),
      handler: (c) => c.json({ ok: true }),
    },
    {
      // Declares a parameter this path does not have — the mistake that in v1
      // became `?? ""` and reached a uuid column as an empty string.
      method: "get",
      path: "/mismatch/:pid",
      security: requires("queries:run", projectFromPath("projectId")),
      handler: (c) => c.json({ ok: true }),
    },
  ];
  const a = new Hono<ApiEnv>();
  a.use("*", async (c, next) => {
    c.set("requestId", "req_test");
    await next();
  });
  return mount(a, routes, createGuard({
    access: stubAccess(over),
    digest: (s) => s,
    now: () => Instant.fromEpochMillis(1_700_000_000_000),
  }));
};

const get = (a: Hono<ApiEnv>, path: string, headers: Record<string, string> = {}) =>
  a.request(path, { headers });

describe("a request with no credential", () => {
  test("reaches a public route as anonymous", async () => {
    const res = await get(app(), "/open");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saw: "anonymous" });
  });

  test("is refused a scoped route with 401 and told how to authenticate", async () => {
    const res = await get(app(), "/p/prj_1");
    expect(res.status).toBe(401);
    // RFC 9728 — the client learns how to authenticate from the response
    // rather than from documentation it has to find.
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="counted"');
  });

  test("the refusal is problem+json carrying the request id", async () => {
    const body = (await (await get(app(), "/p/prj_1")).json()) as Record<string, unknown>;
    expect(body["status"]).toBe(401);
    expect(body["requestId"]).toBe("req_test");
    expect(body["type"]).toBe("https://counted.dev/problems/unauthenticated");
  });
});

describe("a credential that does not resolve", () => {
  test("is treated exactly like no credential at all", async () => {
    // Same status, same body, same headers. A revoked key and a made-up key
    // must be indistinguishable, or the difference enumerates real keys.
    const nothing = await get(app(), "/p/prj_1");
    const garbage = await get(app(), "/p/prj_1", { authorization: "Bearer sk_nonsense" });
    expect(garbage.status).toBe(nothing.status);
    expect(await garbage.json()).toEqual(await nothing.json());
  });

  test("a malformed Authorization header is not a partial credential", async () => {
    const res = await get(app(), "/p/prj_1", { authorization: "sk_no_scheme" });
    expect(res.status).toBe(401);
  });
});

describe("a resolving credential", () => {
  const configured = { principals: { sk_good: serviceKey }, placements: { prj_1: placement } };

  test("passes when its scopes and binding both allow", async () => {
    const res = await get(app(configured), "/p/prj_1", { authorization: "Bearer sk_good" });
    expect(res.status).toBe(200);
  });

  test("is accepted from the SDK header aliases too", async () => {
    // Deployed clients already send these. A rewrite that breaks every one of
    // them is not a rewrite anyone can ship.
    for (const header of ["app-key", "project-key"]) {
      const res = await get(app(configured), "/p/prj_1", { [header]: "sk_good" });
      expect(res.status).toBe(200);
    }
  });

  test("gets 403 for a scope it does not carry", async () => {
    const readOnly: Principal = { ...serviceKey, scopes: ["events:read"] };
    const res = await get(app({ principals: { sk_ro: readOnly }, placements: { prj_1: placement } }), "/p/prj_1", {
      authorization: "Bearer sk_ro",
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  test("gets 404 — not 403 — for a resource in another workspace", async () => {
    // 403 would confirm the id exists. Probing must not enumerate other
    // tenants' projects.
    const elsewhere: Placement = { workspace: WorkspaceId("ws_2"), project: ProjectId("prj_9") };
    const res = await get(
      app({ principals: { sk_good: serviceKey }, placements: { prj_9: elsewhere } }),
      "/p/prj_9",
      { authorization: "Bearer sk_good" },
    );
    expect(res.status).toBe(404);
  });

  test("a nonexistent resource and a forbidden one answer identically", async () => {
    const elsewhere: Placement = { workspace: WorkspaceId("ws_2"), project: ProjectId("prj_9") };
    const forbidden = await get(
      app({ principals: { sk_good: serviceKey }, placements: { prj_9: elsewhere } }),
      "/p/prj_9",
      { authorization: "Bearer sk_good" },
    );
    const missing = await get(app({ principals: { sk_good: serviceKey } }), "/p/prj_404", {
      authorization: "Bearer sk_good",
    });
    expect(forbidden.status).toBe(missing.status);
    // Byte-identical, including the problem `type`. A differing type URI is
    // as good an enumeration oracle as a differing status.
    expect(await forbidden.json()).toEqual(await missing.json());
  });
});

describe("the principal is attached even when the request is denied", () => {
  test("a public route sees who was asking", async () => {
    const res = await get(app({ principals: { sk_good: serviceKey } }), "/open", {
      authorization: "Bearer sk_good",
    });
    expect(await res.json()).toEqual({ saw: "service" });
  });
});

describe("a declaration that names a parameter its path lacks", () => {
  test("fails closed with a 500, rather than authorizing an empty id", async () => {
    // The alternative — `?? ""` — is what v1 did, and an empty string reaching
    // a uuid column threw in Postgres, got swallowed, and rendered a blank
    // chart. Whatever this is, it is not the user's fault and not a 403.
    const res = await get(app({ principals: { sk_good: serviceKey } }), "/mismatch/prj_1", {
      authorization: "Bearer sk_good",
    });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("sk_good");
  });
});

describe("responses never echo the credential", () => {
  test("no denial body or header contains the presented secret", async () => {
    for (const path of ["/p/prj_1", "/mismatch/prj_1"]) {
      const res = await get(app(), path, { authorization: "Bearer sk_super_secret_value" });
      const text = await res.text();
      expect(text).not.toContain("sk_super_secret_value");
      expect([...res.headers.values()].join(" ")).not.toContain("sk_super_secret_value");
    }
  });
});
