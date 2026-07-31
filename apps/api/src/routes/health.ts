/**
 * Health.
 *
 * Two endpoints, because they answer different questions and a load balancer
 * needs to tell them apart:
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

import { Hono } from "hono";
import type { Dependencies } from "../composition";

export const healthRoutes = (deps: Dependencies): Hono => {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      release: deps.config.release,
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );

  app.get("/health/ready", async (c) => {
    const startedAt = Date.now();
    try {
      // A trivial request through the real port, so readiness exercises the
      // same path traffic will.
      const outcome = await deps.store.executeBatch([], {
        deadlineMs: 2_000,
        traceId: "health",
      });
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
  });

  return app;
};
