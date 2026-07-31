/**
 * Share links.
 *
 * A share is a real credential: prefixed, hashed, scoped to reading one
 * dashboard, expiring, and revocable. It resolves through the same
 * `AccessResolver` and the same `decide` as every other principal.
 *
 * v1's version was none of those things. The token granted data access through
 * server-rendered HTML only — there was no API behind it, so the page queried
 * the database directly with the application's own credentials and rendered
 * the result. It never expired, could not be revoked without deleting the
 * dashboard, and the shared page was indexable.
 *
 * Four endpoints:
 *
 *   `POST   /v1/dashboards/{id}/share`   mint a link. Token returned once.
 *   `DELETE /v1/dashboards/{id}/share`   revoke it. Immediately.
 *   `GET    /v1/shared/dashboard`        what the link points at.
 *   `POST   /v1/shared/dashboard/render` its tiles, answered.
 *
 * The last two take no id: the token *is* the dashboard, so a link cannot name
 * a different one.
 */

import { DashboardId, Duration, Instant, ReadoutId, type Principal } from "@counted/domain";
import { runQuestions, type Ask } from "@counted/application";
import { CreateShareRequestSchema, fieldsFrom, validationDetail } from "@counted/contracts";
import type { Context } from "hono";
import type { Dependencies } from "../composition";
import type { ApiEnv } from "../server";
import { dashboardFromPath, ownDashboard, requires, type RouteDefinition } from "../http/route";
import { sendProblem } from "../http/respond";
import { dashboardView } from "./views";
import { questionFromTile, readoutToWire } from "./query";

/** A shared dashboard's tiles share one budget, same as an owned one. */
const RENDER_DEADLINE_MS = 20_000;

/**
 * Keep a shared page out of search results.
 *
 * Three layers because each covers a case the others do not: the header
 * applies to the API response itself, `noarchive` stops a cached copy
 * outliving a revocation, and the web app emits the meta tag and a
 * `robots.txt` rule for the HTML page. v1 had none of them, so a shared
 * dashboard could be — and for at least one customer was — indexed.
 */
const NOINDEX = "noindex, nofollow, noarchive";

const shielded = (c: Context<ApiEnv>): void => {
  c.header("x-robots-tag", NOINDEX);
  // A link that anyone holding the URL can read must not sit in a shared
  // cache where the next person on that IP gets it.
  c.header("cache-control", "private, no-store");
};

export const shareRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
  {
    method: "post",
    path: "/v1/dashboards/:dashboardId/share",
    // Minting a link is a write: it creates a way to read the data without
    // logging in, which is not something a reader should be able to do.
    security: requires("dashboards:write", dashboardFromPath()),
    handler: async (c) => {
      let raw: unknown = {};
      try {
        raw = await c.req.json();
      } catch {
        // An empty body is fine — the schema's defaults apply.
      }
      const parsed = CreateShareRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const fields = fieldsFrom(parsed.error);
        return sendProblem(c, "request.validation_failed", { detail: validationDetail(fields), fields });
      }

      const at = deps.clock.now();
      const expiresAt = Instant.plus(at, Duration.hours(parsed.data.expiresInHours));
      const token = deps.grants.issue("share");

      const result = await deps.unitOfWork.transact(async (r) => {
        const dashboard = await r.dashboards.find(DashboardId(c.req.param("dashboardId")!));
        if (dashboard === null) return null;
        // Only the digest is stored. A database dump does not hand anyone a
        // working link, and there is no endpoint that can read one back.
        const applied = dashboard.grantShare({ digest: deps.secrets.digest(token), expiresAt }, at);
        if (!applied.ok) return { failed: true as const };
        await r.dashboards.save(applied.value.dashboard, applied.value.events);
        return { failed: false as const, dashboard: applied.value.dashboard };
      });

      if (result === null) return sendProblem(c, "resource.not_found");
      if (result.failed) {
        return sendProblem(c, "request.validation_failed", { detail: "That expiry is already in the past." });
      }

      c.get("log").info("share.granted", {
        dashboardId: c.req.param("dashboardId"),
        expiresAt: Instant.toISO(expiresAt),
      });

      // Shown once. Replacing a link revokes the previous one, so this is also
      // how rotation works.
      return c.json({ token, expiresAt: Instant.toISO(expiresAt), dashboard: dashboardView(result.dashboard) }, 201);
    },
  },
  {
    method: "delete",
    path: "/v1/dashboards/:dashboardId/share",
    security: requires("dashboards:write", dashboardFromPath()),
    handler: async (c) => {
      const at = deps.clock.now();
      const result = await deps.unitOfWork.transact(async (r) => {
        const dashboard = await r.dashboards.find(DashboardId(c.req.param("dashboardId")!));
        if (dashboard === null) return null;
        const applied = dashboard.unshare(at);
        // Not shared is the state the caller asked for, so revoking twice is
        // not an error.
        if (!applied.ok) return { already: true as const };
        await r.dashboards.save(applied.value.dashboard, applied.value.events);
        return { already: false as const };
      });

      if (result === null) return sendProblem(c, "resource.not_found");
      if (!result.already) c.get("log").info("share.revoked", { dashboardId: c.req.param("dashboardId") });
      // Immediate: the digest is gone, so the next request with that token
      // resolves to nobody.
      return c.body(null, 204);
    },
  },
  {
    method: "get",
    path: "/v1/shared/dashboard",
    security: requires("dashboards:read", ownDashboard()),
    handler: async (c) => {
      const principal = c.get("principal") as Extract<Principal, { kind: "share" }>;
      const dashboard = await deps.unitOfWork.transact((r) => r.dashboards.find(principal.dashboard));
      if (dashboard === null) return sendProblem(c, "resource.not_found");

      shielded(c);
      return c.json(dashboardView(dashboard));
    },
  },
  {
    method: "post",
    path: "/v1/shared/dashboard/render",
    security: requires("dashboards:read", ownDashboard()),
    handler: async (c) => {
      const principal = c.get("principal") as Extract<Principal, { kind: "share" }>;
      const dashboard = await deps.unitOfWork.transact((r) => r.dashboards.find(principal.dashboard));
      if (dashboard === null) return sendProblem(c, "resource.not_found");

      const asks: readonly Ask[] = dashboard.tiles.map((tile) => ({
        id: ReadoutId(String(tile.id)),
        project: tile.project,
        question: questionFromTile(tile.content),
      }));

      const { readouts, statements } = await runQuestions(deps.store, asks, {
        now: deps.clock.now(),
        deadlineMs: RENDER_DEADLINE_MS,
        traceId: c.get("trace").traceId,
      });

      c.get("log").info("share.rendered", {
        dashboardId: String(principal.dashboard),
        tiles: asks.length,
        failed: readouts.filter((r) => !r.ok).length,
        statements,
      });

      shielded(c);
      return c.json({
        readouts: readouts.map(readoutToWire),
        statements,
        computedAt: Instant.toISO(deps.clock.now()),
      });
    },
  },
];
