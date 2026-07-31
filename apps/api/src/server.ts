/**
 * The Hono app.
 *
 * Routes are mounted here and take their dependencies as an argument, so a
 * test can build the whole API over stub ports with no server and no database.
 */

import { Hono } from "hono";
import type { Dependencies } from "./composition";
import { healthRoutes } from "./routes/health";

/** Per-request state. Declared so `c.get`/`c.set` are typed rather than any. */
export type ApiEnv = { Variables: { requestId: string } };

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

  app.route("/", healthRoutes(deps));

  app.notFound((c) =>
    c.json({ type: "about:blank", title: "Not Found", status: 404, detail: `No route for ${c.req.path}` }, 404),
  );

  return app;
};
