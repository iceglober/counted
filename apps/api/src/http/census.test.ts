/**
 * The route census.
 *
 * This is the gate the issue asks for: every route the API serves has declared
 * what it requires. It works by walking Hono's *own* registry rather than our
 * list, so a route added with `app.get(...)` directly — bypassing `mount` and
 * therefore the guard — is caught rather than trusted.
 *
 * v1 had no equivalent, and the consequence was not theoretical: several
 * routes simply had no authorization at all, and `/provision` was not even in
 * the hand-written OpenAPI document.
 */

import { describe, expect, test } from "bun:test";
import { CredentialId, Entitlement, Instant, ProjectId, Quota, ALL_SCOPES, type Principal } from "@counted/domain";
import { Coalescer } from "../ingest/coalescer";
import type { AnalyticalStore, EventWriter } from "@counted/ports";
import { buildOpenApiDocument } from "@counted/contracts";
import { createApp, allRoutes, routeCensus } from "../server";
import type { Config, Dependencies } from "../composition";
import { publicRoute, requires, projectFromPath, census, type RouteDefinition } from "./route";
import { stubAccess, silentLogger } from "../server.test";

const config: Config = { databaseUrl: "postgres://stub", port: 8080, release: "test" };

const writer: EventWriter = {
  append: async () => ({ accepted: 0, deduplicated: 0, written: [], committedAt: Instant.fromEpochMillis(0) }),
};

const deps: Dependencies = {
  access: stubAccess(),
  log: silentLogger(),
  grants: { issue: (kind: "share" | "claim") => `${kind === "share" ? "st" : "ct"}_stubGrantTokenValue000000` },
  ids: { next: () => "00000000-0000-7000-8000-000000000000" },
  quota: { decide: async () => Quota.decide(Entitlement.none(), { used: 0 }) },
  ingest: new Coalescer(writer, { windowMs: 0 }),
  secrets: { issue: () => ({ secret: "", digest: "" as never, prefix: "" as never }), digest: (s) => s as never },
  store: {
    executeBatch: async () => ({ results: new Map(), stats: { statements: 0, totalMs: 0, coalesced: 0 } }),
    capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
  } as AnalyticalStore,
  writer,
  unitOfWork: { transact: async (w: never) => w } as unknown as Dependencies["unitOfWork"],
  clock: { now: () => Instant.fromEpochMillis(1_700_000_000_000) },
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

/** What Hono actually serves, deduplicated — one entry per method+path. */
const served = (): readonly string[] => {
  const app = createApp(deps);
  return [
    ...new Set(
      app.routes
        // `app.use("*")` registers with method ALL. Middleware is not a route.
        .filter((r) => r.method !== "ALL")
        .map((r) => `${r.method} ${r.path}`),
    ),
  ].sort();
};

describe("every route the API serves has declared what it requires", () => {
  test("nothing is served that is not in the census", () => {
    // The direction that matters. A route registered directly on the Hono app
    // never passes through `mount`, so it never gets a guard — and this is the
    // only thing that would notice.
    const declared = new Set(routeCensus(deps).map((r) => `${r.method} ${r.path}`));
    for (const route of served()) expect({ route, declared: [...declared] }).toMatchObject({
      declared: expect.arrayContaining([route]),
    });
  });

  test("nothing is in the census that is not served", () => {
    // A declaration for a route that no longer exists is stale documentation,
    // and stale documentation about authorization is worse than none.
    expect(routeCensus(deps).map((r) => `${r.method} ${r.path}`).sort()).toEqual([...served()]);
  });

  test("the census is not empty, or the two assertions above are vacuous", () => {
    expect(served().length).toBeGreaterThan(0);
  });

  test("every entry either requires a scope or explains why it is public", () => {
    for (const entry of routeCensus(deps)) {
      const declaredScope = entry.scope !== null;
      const explained = entry.why !== null && entry.why.length >= 20;
      expect({ ...entry, ok: declaredScope || explained }).toMatchObject({ ok: true });
    }
  });

  test("a declared scope is one the domain knows", () => {
    for (const entry of routeCensus(deps)) {
      if (entry.scope !== null) expect(ALL_SCOPES).toContain(entry.scope);
    }
  });
});

describe("every route the API serves is in the published document", () => {
  /**
   * Hono writes `:projectId`; OpenAPI writes `{projectId}`. Same route, two
   * spellings, and comparing them is the only thing that notices when a new
   * endpoint ships undocumented.
   *
   * The contracts package cannot import the route table — it is an inner layer
   * — so the comparison belongs here, where both are visible. This is what the
   * hand-written path list in the contracts test could not do: it asserted the
   * document against itself.
   */
  const documented = (): ReadonlySet<string> => {
    const doc = buildOpenApiDocument() as { paths: Record<string, Record<string, unknown>> };
    const out = new Set<string>();
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const method of Object.keys(operations)) out.add(`${method.toUpperCase()} ${path}`);
    }
    return out;
  };

  const asOpenApi = (honoPath: string): string => honoPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

  test("nothing is served that the document does not describe", () => {
    // v1's spec omitted `/provision` entirely — the endpoint its own agent
    // cards advertised as the entry point.
    const docs = documented();
    for (const entry of routeCensus(deps)) {
      const key = `${entry.method} ${asOpenApi(entry.path)}`;
      expect({ route: key, documented: [...docs] }).toMatchObject({
        documented: expect.arrayContaining([key]),
      });
    }
  });

  test("nothing is described that is not served", () => {
    // The other direction: a documented endpoint that does not exist sends an
    // integrator to write code against nothing.
    const served = new Set(routeCensus(deps).map((e) => `${e.method} ${asOpenApi(e.path)}`));
    for (const documentedRoute of documented()) {
      expect({ documented: documentedRoute, served: [...served] }).toMatchObject({
        served: expect.arrayContaining([documentedRoute]),
      });
    }
  });
});

describe("a scoped route names a path parameter its path actually has", () => {
  /**
   * The failure this catches: `requires("projects:read", projectFromPath())`
   * on a path declared as `/v1/projects/:pid`. The lookup returns undefined,
   * and the only reason that is not a silently-authorized empty id is that the
   * extractor returns null. Better to never ship it.
   */
  const resolvesAgainstItsOwnPath = (route: RouteDefinition): boolean => {
    if (route.security.kind === "public") return true;
    const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const context = {
      req: { param: (name: string) => (params.includes(name) ? "00000000-0000-0000-0000-000000000000" : undefined) },
      // A principal that can name a resource, so a route deriving its resource
      // from the credential rather than the path is exercised too.
      get: (key: string) =>
        key === "principal"
          ? ({ kind: "ingest", credential: CredentialId("c"), project: ProjectId("p"), scopes: ["events:write"] } satisfies Principal)
          : undefined,
    };
    // `misconfigured` is the failure this looks for: a declaration naming a
    // path parameter the pattern does not have. `wrong_principal` is a
    // legitimate runtime refusal and not a routing mistake.
    return route.security.resource(context as never).kind !== "misconfigured";
  };

  test("every scoped route resolves its resource from its own pattern", () => {
    for (const route of allRoutes(deps)) {
      expect({ path: route.path, resolves: resolvesAgainstItsOwnPath(route) }).toMatchObject({ resolves: true });
    }
  });

  test("the check has teeth — a deliberate mismatch fails it", () => {
    // Guards that do not guard have cost me real time on this rewrite, so
    // this asserts the detector detects.
    const mismatched: RouteDefinition = {
      method: "get",
      path: "/v1/projects/:pid",
      security: requires("projects:read", projectFromPath("projectId")),
      handler: (c) => c.json({}),
    };
    expect(resolvesAgainstItsOwnPath(mismatched)).toBe(false);

    const correct: RouteDefinition = { ...mismatched, security: requires("projects:read", projectFromPath("pid")) };
    expect(resolvesAgainstItsOwnPath(correct)).toBe(true);
  });
});

describe("the census reports what it was given", () => {
  test("a public route carries its reason, a scoped route carries its scope", () => {
    const entries = census([
      {
        method: "get",
        path: "/a",
        security: publicRoute("because it is a health check for a load balancer"),
        handler: (c) => c.json({}),
      },
      {
        method: "post",
        path: "/b/:projectId",
        security: requires("events:write", projectFromPath()),
        handler: (c) => c.json({}),
      },
    ]);
    expect(entries[0]).toMatchObject({ method: "GET", scope: null });
    expect(entries[1]).toMatchObject({ method: "POST", scope: "events:write", why: null });
  });
});
