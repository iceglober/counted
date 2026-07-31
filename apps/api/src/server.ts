/**
 * The Hono app.
 *
 * Routes are mounted here and take their dependencies as an argument, so a
 * test can build the whole API over stub ports with no server and no database.
 */

import { Hono } from "hono";
import type { Principal } from "@counted/domain";
import type { Dependencies } from "./composition";
import { healthRoutes } from "./routes/health";
import { createGuard } from "./http/guard";
import { census, mount, type RouteDefinition } from "./http/route";

/**
 * Per-request state. Declared so `c.get`/`c.set` are typed rather than any.
 *
 * `principal` is set by the guard on every request, including denied ones, so
 * a log line can say who was refused.
 */
export type ApiEnv = { Variables: { requestId: string; principal: Principal } };

export const createApp = (deps: Dependencies): Hono<ApiEnv> => {
  const app = new Hono<ApiEnv>();

  // Request id on every response, so a report of "it failed at 14:32" is
  // traceable. v1 had none, anywhere.
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    await next();
    c.header("x-request-id", requestId);
  });

  // Every route in the app, declared. The census test walks Hono's own
  // registry and fails if anything reached it by another path.
  mount(app, allRoutes(deps), createGuard({
    access: deps.access,
    digest: deps.secrets.digest,
    now: () => deps.clock.now(),
  }));

  app.notFound((c) =>
    c.json({ type: "about:blank", title: "Not Found", status: 404, detail: `No route for ${c.req.path}` }, 404),
  );

  return app;
};

/** Every route definition, in one list, so the census can be exhaustive. */
export const allRoutes = (deps: Dependencies): readonly RouteDefinition[] => [...healthRoutes(deps)];

export const routeCensus = (deps: Dependencies) => census(allRoutes(deps));
