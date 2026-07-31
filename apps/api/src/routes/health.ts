/**
 * Health, and who-am-I.
 *
 * Two health endpoints, because they answer different questions and a load
 * balancer needs to tell them apart:
 *
 *   /health        liveness — is this process running? Never touches the
 *                  database, so a database blip does not cause a restart loop.
 *   /health/ready  readiness — can it serve traffic? Pings the store.
 *
 * v1 had one endpoint returning `{status:"ok"}` that checked the database, so
 * a slow database looked like a dead process and orchestrators restarted a
 * perfectly healthy container.
 *
 * The payload reports store capabilities because "why is this chart odd?" six
 * months from now is much easier to answer when the deployment can say what it
 * is running on. It reports no connection strings and no secrets.
 */

import { Principal, type Scope } from "@counted/domain";
import { appliedFingerprint } from "@counted/adapter-postgres";
import { buildOpenApiDocument } from "@counted/contracts";
import type { Dependencies } from "../composition";
import { publicRoute, type RouteDefinition } from "../http/route";

export const healthRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
  {
    method: "get",
    path: "/v1/openapi.json",
    security: publicRoute("The contract. Refusing to show it to an anonymous caller would defeat the point."),
    handler: (c) => {
      // The same document CI drift-gates against the committed artifact, so
      // this cannot describe an API the server does not implement.
      //
      // It is *advertised* in two places already — the `Link` header on every
      // 410 from the compat edge, and the docs — and until now neither
      // resolved. A successor URI that 404s is worse than none: it sends
      // somebody who did the right thing to a dead end.
      c.header("cache-control", "public, max-age=300");
      return c.json(buildOpenApiDocument());
    },
  },
  {
    method: "get",
    path: "/health",
    security: publicRoute("Liveness. A load balancer cannot authenticate, and it reveals nothing."),
    handler: (c) =>
      c.json({
        status: "ok",
        release: deps.config.release,
        uptimeSeconds: Math.round(process.uptime()),
      }),
  },
  {
    method: "get",
    path: "/health/ready",
    security: publicRoute("Readiness. Same reason as /health; reports capabilities, never configuration."),
    handler: async (c) => {
      const startedAt = Date.now();
      try {
        // A trivial request through the real port, so readiness exercises the
        // same path traffic will.
        const outcome = await deps.store.executeBatch([], { deadlineMs: 2_000, traceId: "health" });

        // The schema this build expects against the one the database says it
        // has. They differ while a deploy is mid-flight — an old replica is
        // still serving after a new one migrated — and that replica is *not*
        // ready: it would answer with a schema it was not built for.
        const applied = await appliedFingerprint(deps.pools.analytics);
        if (applied !== deps.schema) {
          return c.json(
            {
              status: "unavailable",
              release: deps.config.release,
              checkMs: Date.now() - startedAt,
              detail:
                applied === null
                  ? "The schema has not been applied yet."
                  : "This build expects a different schema than the database reports. A deploy is probably in flight.",
            },
            503,
          );
        }

        return c.json({
          status: "ready",
          release: deps.config.release,
          checkMs: Date.now() - startedAt,
          store: {
            engine: deps.boot.capabilities.engine,
            partitioning: deps.boot.capabilities.partitioning,
            timescale: deps.boot.capabilities.timescale,
            approximateDistinct: deps.boot.capabilities.approximateDistinct,
            timeZone: deps.boot.capabilities.timeZone,
          },
          bucketContract: deps.boot.bucketContract.ok
            ? { verified: true, samples: deps.boot.bucketContract.checked }
            : { verified: false },
          schema: deps.schema,
          statements: outcome.stats.statements,
        });
      } catch (e) {
        return c.json(
          {
            status: "unavailable",
            release: deps.config.release,
            checkMs: Date.now() - startedAt,
            detail: e instanceof Error ? e.message : "unknown",
          },
          503,
        );
      }
    },
  },
  {
    method: "get",
    path: "/v1/me",
    // Public in the sense that anyone may ask; the answer is about the caller
    // and nothing else, and for an anonymous caller it is "you are anonymous".
    security: publicRoute("Describes the caller to itself. Reveals nothing the caller did not present."),
    handler: async (c) => {
      const principal = c.get("principal");

      // Where this caller may go, with the role it holds in each. Reported
      // here rather than from a separate endpoint because "who am I" and
      // "where do I belong" are one question for anybody starting a session,
      // and a console that had to guess would be doing something no
      // integrator could.
      //
      // Only for an account: a credential is bound to one workspace already,
      // and listing it would tell the holder of an ingest key about the
      // tenancy above it.
      const workspaces =
        principal.kind === "account"
          ? await deps.unitOfWork.transact((repos) => repos.workspaces.listForAccount(principal.account))
          : [];

      return c.json({
        principal: Principal.describe(principal),
        kind: principal.kind,
        // What this caller may do, so an integrator can debug a 403 without
        // guessing. v1 had no way to ask this at all.
        ...effectiveScopes(principal),
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
      });
    },
  },
];

/**
 * The scopes a principal carries independent of any resource.
 *
 * For an account there are none. Authority comes from membership and differs
 * per workspace, so any list here would be wrong for some workspace — and
 * `scopeSource: "membership"` is what says where to look instead. That is
 * different from `"none"`, which means the caller is nobody.
 *
 * This used to return `ROLE_SCOPES.owner`, directly contradicting the comment
 * above it and telling every signed-in account it could do everything. The
 * branch was unreachable until console sessions existed, so nothing had ever
 * observed it.
 */
const effectiveScopes = (
  p: Principal,
): { readonly scopeSource: string; readonly scopes: readonly Scope[] } => {
  switch (p.kind) {
    case "anonymous":
      return { scopeSource: "none", scopes: [] };
    case "account":
      return { scopeSource: "membership", scopes: [] };
    default:
      return { scopeSource: "credential", scopes: p.scopes };
  }
};
