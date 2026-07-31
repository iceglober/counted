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

import { Principal, ROLE_SCOPES, type Scope } from "@counted/domain";
import type { Dependencies } from "../composition";
import { publicRoute, type RouteDefinition } from "../http/route";

export const healthRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
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
    handler: (c) => {
      const principal = c.get("principal");
      return c.json({
        principal: Principal.describe(principal),
        kind: principal.kind,
        // What this caller may do, so an integrator can debug a 403 without
        // guessing. v1 had no way to ask this at all.
        ...effectiveScopes(principal),
      });
    },
  },
];

/**
 * The scopes a principal carries independent of any resource.
 *
 * For an account this is unknowable without naming a workspace — authority
 * comes from membership, which differs per workspace — so it says so rather
 * than returning a number that would be wrong somewhere.
 */
const effectiveScopes = (
  p: Principal,
): { readonly scopeSource: string; readonly scopes: readonly Scope[] } => {
  switch (p.kind) {
    case "anonymous":
      return { scopeSource: "none", scopes: [] };
    case "account":
      return { scopeSource: "membership", scopes: ROLE_SCOPES.owner };
    default:
      return { scopeSource: "credential", scopes: p.scopes };
  }
};
