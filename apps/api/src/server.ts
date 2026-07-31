/**
 * The Hono app.
 *
 * Routes are mounted here and take their dependencies as an argument, so a
 * test can build the whole API over stub ports with no server and no database.
 *
 * The middleware order is deliberate and thin: identity of the request first
 * (id, trace), then routing, then one error handler behind everything. Nothing
 * downstream needs to know how a request id is made or how a failure is
 * shaped.
 */

import { Hono } from "hono";
import type { Principal } from "@counted/domain";
import { requestId as mintRequestId } from "@counted/adapter-crypto";
import type { Dependencies } from "./composition";
import { healthRoutes } from "./routes/health";
import { ingestRoutes } from "./routes/ingest";
import { queryRoutes } from "./routes/query";
import { managementRoutes } from "./routes/management";
import { shareRoutes } from "./routes/share";
import { billingRoutes } from "./routes/billing";
import { authRoutes } from "./routes/auth";
import { createGuard } from "./http/guard";
import { census, mount, type RouteDefinition } from "./http/route";
import { sendProblem } from "./http/respond";
import { traceContextFrom, type TraceContext } from "./http/trace";
import type { Logger } from "./http/log";
import { corsHeadersFor, originPolicyFor } from "./http/session";

/**
 * Per-request state. Declared so `c.get`/`c.set` are typed rather than any.
 *
 * `principal` is set by the guard on every request, including denied ones, so
 * a log line can say who was refused. `log` is already bound to this request's
 * ids, so no handler has to remember to attach them.
 */
export type ApiEnv = {
  Variables: {
    requestId: string;
    trace: TraceContext;
    principal: Principal;
    log: Logger;
  };
};

/**
 * The response header carrying the request id.
 *
 * Named rather than `x-`, which RFC 6648 deprecated, and exposed to browsers
 * so the web app and the SDKs can read it — a header a client cannot see is
 * not a support tool.
 */
export const REQUEST_ID_HEADER = "counted-request-id";

export const createApp = (deps: Dependencies): Hono<ApiEnv> => {
  const app = new Hono<ApiEnv>();
  const origins = originPolicyFor(deps.config.appUrl);

  /**
   * CORS, for the console only.
   *
   * The origin is echoed from an allowlist rather than reflected, and never
   * `*` — with `Allow-Credentials: true` a browser refuses `*` outright, so
   * the lazy version does not merely weaken this, it silently signs every
   * request out.
   *
   * Ingest is deliberately not covered by the allowlist: `POST /v1/events` is
   * called from every customer's own origin, which is why it authenticates
   * with a key rather than a cookie and needs no credentialled CORS.
   */
  app.use("*", async (c, next) => {
    const headers = corsHeadersFor(c.req.header("origin"), origins);

    if (c.req.method === "OPTIONS") {
      // Answered here rather than by a route: a preflight names the method it
      // is asking about, and there is no handler for OPTIONS on any path.
      const preflight = new Response(null, { status: 204 });
      for (const [name, value] of Object.entries(headers)) preflight.headers.set(name, value);
      if (Object.keys(headers).length > 0) {
        preflight.headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
        preflight.headers.set(
          "access-control-allow-headers",
          `content-type, authorization, if-match, traceparent, ${REQUEST_ID_HEADER}`,
        );
        preflight.headers.set("access-control-max-age", "600");
      }
      return preflight;
    }

    await next();
    for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
  });

  app.use("*", async (c, next) => {
    // An id supplied by a caller is accepted only if it looks like one of
    // ours. Otherwise a client could set it to anything and poison the logs,
    // or collide two unrelated requests onto the same id.
    const supplied = c.req.header(REQUEST_ID_HEADER);
    const requestId = supplied !== undefined && /^req_[0-9A-HJKMNP-TV-Z]{26}$/.test(supplied)
      ? supplied
      : mintRequestId();
    const trace = traceContextFrom(c.req.header("traceparent"));

    c.set("requestId", requestId);
    c.set("trace", trace);
    c.set("log", deps.log.with({ requestId, traceId: trace.traceId, spanId: trace.spanId }));

    // Set before the handler runs, so the id is present even on a response
    // written by an error path that never returns here.
    c.header(REQUEST_ID_HEADER, requestId);
    c.header("access-control-expose-headers", `${REQUEST_ID_HEADER}, retry-after`);

    const startedAt = Date.now();
    await next();

    // One line per request. `http.request` is the counter the deployment
    // alerts on; nothing else needs to be emitted for that to work.
    c.get("log").info("http.request", {
      method: c.req.method,
      // The matched pattern, not the concrete path — otherwise every project
      // id becomes its own cardinality bucket and the counter is useless.
      route: c.req.routePath,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
      principalKind: c.get("principal")?.kind ?? "anonymous",
    });
  });

  // Every route in the app, declared. The census test walks Hono's own
  // registry and fails if anything reached it by another path.
  mount(app, allRoutes(deps), createGuard({
    access: deps.access,
    digest: deps.secrets.digest,
    now: () => deps.clock.now(),
    console: deps.console,
    origins,
  }));

  app.notFound((c) => sendProblem(c, "resource.not_found", { detail: `No route for ${c.req.method} ${c.req.path}.` }));

  app.onError((error, c) => {
    // The one place an unhandled throw becomes a response. It is logged with
    // the stack and answered without one: a stack trace in a response body is
    // a description of our source tree handed to whoever asked.
    c.get("log").error("http.unhandled", {
      error: error.message,
      stack: error.stack,
      route: c.req.routePath,
    });
    return sendProblem(c, "internal.error");
  });

  return app;
};

/** Every route definition, in one list, so the census can be exhaustive. */
export const allRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
  ...healthRoutes(deps),
  ...ingestRoutes(deps),
  ...queryRoutes(deps),
  ...managementRoutes(deps),
  ...shareRoutes(deps),
  ...billingRoutes(deps),
  ...authRoutes(deps),
];

export const routeCensus = (deps: Dependencies) => census(allRoutes(deps));
