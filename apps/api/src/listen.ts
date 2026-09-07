import type { Hono } from "hono";
import type { ApiEnv } from "./server";

/** The HTTP transport, shared by startup and the real-socket regression test. */
export const listen = (api: Pick<Hono<ApiEnv>, "fetch">, port: number) =>
  Bun.serve({
    port,
    // Bun's 10-second default also closes requests still awaiting a response.
    // Leave room for authentication, database waits and the query deadline,
    // while retaining a finite limit for stalled connections.
    idleTimeout: 60,
    fetch: api.fetch,
  });
