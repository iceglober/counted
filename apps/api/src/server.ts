/**
 * The HTTP surface: one oRPC handler and three routes that cannot be one.
 *
 * `OpenAPIHandler` serves all 53 procedures the contract describes. Three
 * things are hand-written, each for a reason that is about the request rather
 * than about preference:
 *
 *   `POST /v1/events`            a group commit, not a request/response shape,
 *                                with a wire format four SDKs implement.
 *   `/api/auth/*`                the auth provider's own router.
 *   `POST /v1/webhooks/stripe`   needs the raw body; a framework that parsed
 *                                the JSON has destroyed what is being verified.
 *
 * They are registered before the catch-all, so oRPC never sees them. The census
 * test asserts the other direction too — that none of the three is a path the
 * contract also describes — because a hand-written route shadowing a contract
 * route is a route that exists in the document and answers something else.
 *
 * `matched` is what turns an unrecognised path into a 404 with our shape rather
 * than oRPC's default, and it is the mechanism that would let the handler be
 * mounted first if the ordering ever needs to change.
 */

import { Hono } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { ORPCError } from "@orpc/client";
import { Instant } from "@counted/kernel";
import { isBlockedIdentityPath } from "@counted/identity-adapter-better-auth";
import type { AuthorizeDeps } from "./auth/authorize";
import type { ApiContext } from "./context";
import type { ApiDependencies } from "./deps";
import { HEALTH_PATH, READY_PATH, alwaysReady, health, readyBody, type ReadinessProbe } from "./health";
import { describeError, type Logger } from "./logging";
import { createRouter } from "./router";
import { TRACE_HEADER, traceOf } from "./tracing";
import { handleIngest, type IngestDeps } from "./ingest/route";
import { handleStripeWebhook, type WebhookDeps } from "./billing/webhook";

/** Where the auth provider's own routes live. Mirrored in `IdentityConfig.baseURL`. */
export const AUTH_MOUNT = "/api/auth";
export const EVENTS_PATH = "/v1/events";
export const STRIPE_WEBHOOK_PATH = "/v1/webhooks/stripe";

/** Every path this server answers that the contract does not describe. */
export const HAND_WRITTEN_PATHS: readonly string[] = [
  HEALTH_PATH,
  READY_PATH,
  EVENTS_PATH,
  STRIPE_WEBHOOK_PATH,
  `${AUTH_MOUNT}/*`,
];

/**
 * What the request middleware puts on the context for everything after it.
 *
 * Typed rather than implicit, so `context.get("at")` cannot silently become
 * `unknown` — and so a route that forgets the middleware is a compile error
 * rather than a `Date` that turns up as `undefined` in a batch's timestamps.
 */
type Variables = {
  trace: string;
  at: Instant;
};

/**
 * The Hono environment this server runs in. Exported because `buildApi`'s
 * return type has to name it: a `Hono<{ Variables }>` is not a bare `Hono`,
 * and erasing the difference with a cast would let a route read a variable
 * the middleware never set.
 */
export type ApiEnv = { Variables: Variables };

export type ServerDeps = {
  readonly deps: ApiDependencies;
  readonly authorize: AuthorizeDeps;
  readonly ingest: IngestDeps;
  /** `null` when no payment provider is configured; the route is not mounted. */
  readonly webhook: WebhookDeps | null;
  /** How a request with no `traceparent` gets its id. */
  readonly mintTraceId: () => string;
  /**
   * What `/health/ready` asks. Omitted, the replica is always ready — correct
   * for a deployment with nothing to check and wrong for one with a database,
   * which is why `main.ts` always supplies one.
   */
  readonly readiness?: ReadinessProbe;
};

const json = (body: unknown, status: number, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const createServer = (server: ServerDeps): Hono<ApiEnv> => {
  const { deps } = server;
  const app = new Hono<ApiEnv>();
  /**
   * An exception that escapes a handler is caught by oRPC, which answers 500
   * with a bare "Internal Server Error" — the right thing for the caller, and
   * invisible to us. Without this interceptor a driver failure inside any of
   * the 53 procedures would produce a 500 nobody ever saw in the logs.
   *
   * A declared `ORPCError` is not logged as a failure: it is a refusal the
   * domain chose, already recorded by the request line, and logging every 404
   * at error level is how a log stops being read.
   */
  const handler = new OpenAPIHandler(createRouter(deps, server.authorize), {
    interceptors: [
      async (options) => {
        try {
          return await options.next();
        } catch (cause) {
          if (!(cause instanceof ORPCError)) {
            deps.logger.error("handler threw", {
              operation: options.path.join("."),
              traceId: options.context.traceId,
              ...describeError(cause),
            });
          }
          throw cause;
        }
      },
    ],
  });
  const startedAt = deps.clock.now();
  const identity = { service: deps.config.serviceName, release: deps.config.release };

  /**
   * One trace id per request, on every log line and on the response.
   *
   * `x-counted-trace` is the header a support ticket quotes, so it goes out on
   * every response including the failures — a 500 with no id is a 500 nobody
   * can look up.
   */
  app.use("*", async (context, next) => {
    const trace = traceOf(context.req.raw.headers, { mint: server.mintTraceId });
    const at = deps.clock.now();
    context.set("trace", trace.id);
    context.set("at", at);

    try {
      await next();
    } finally {
      context.res.headers.set(TRACE_HEADER, trace.id);
    }

    deps.logger.info("request", {
      method: context.req.method,
      path: new URL(context.req.url).pathname,
      status: context.res.status,
      traceId: trace.id,
      durationMs: Instant.toEpochMillis(deps.clock.now()) - Instant.toEpochMillis(at),
    });
  });

  /**
   * The browser SDK posts from arbitrary origins, so ingest is open. Nothing
   * else is: the console forwards through its own server and holds no
   * credential of its own, so an `Access-Control-Allow-Origin: *` on the
   * management API would only ever help somebody else's page.
   */
  app.options(EVENTS_PATH, () =>
    new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "86400",
      },
    }),
  );

  app.get(HEALTH_PATH, () =>
    json(health(identity, startedAt, deps.clock.now()), 200, {}),
  );

  /**
   * 503 when not ready, so Railway keeps the previous replica serving. A
   * readiness probe that threw would be a 500, which the platform reads the
   * same way but which tells an operator nothing — so a failing probe is
   * reported as not-ready with its message.
   */
  app.get(READY_PATH, async () => {
    const probe = server.readiness ?? alwaysReady;
    const readiness = await probe().catch((cause: unknown) => ({
      ready: false,
      detail: cause instanceof Error ? cause.message : String(cause),
    }));
    return json(readyBody(identity, readiness), readiness.ready ? 200 : 503, {});
  });

  app.post(EVENTS_PATH, async (context) => {
    const at = context.get("at") ?? deps.clock.now();
    const outcome = await handleIngest(server.ingest, context.req.raw, at);
    return json(outcome.body, outcome.status, {
      ...outcome.headers,
      "access-control-allow-origin": "*",
    });
  });

  /**
   * The auth provider's own router, minus the two families the identity
   * adapter nails shut — key CRUD and organization create/delete. Blocked paths
   * answer 404 rather than 403: a 403 confirms the endpoint exists and the
   * caller merely lacks permission, which is an invitation to keep trying.
   */
  /**
   * Which social providers this deployment offers.
   *
   * The one thing about sign-in the console cannot work out for itself: the
   * client ids live here, and a button for a provider nobody configured is a
   * button that fails after the redirect. Under the auth mount because that is
   * where the rest of the sign-in surface is and the console already proxies
   * that family — better-auth registers no route of this name, and this one is
   * declared first, so it answers rather than being forwarded. It carries no
   * secret; not even the client id, which is public anyway.
   */
  app.get(`${AUTH_MOUNT}/providers`, () =>
    json(
      {
        providers: [
          ...(deps.config.social.github === null ? [] : ["github"]),
          ...(deps.config.social.google === null ? [] : ["google"]),
        ],
      },
      200,
      {},
    ),
  );

  app.all(`${AUTH_MOUNT}/*`, async (context) => {
    const path = new URL(context.req.url).pathname.slice(AUTH_MOUNT.length) || "/";
    if (isBlockedIdentityPath(path)) return json({ error: "not_found" }, 404, {});
    return deps.identity.http.handle(context.req.raw);
  });

  if (server.webhook !== null) {
    const webhook = server.webhook;
    app.post(STRIPE_WEBHOOK_PATH, async (context) => {
      const at = context.get("at") ?? deps.clock.now();
      const outcome = await handleStripeWebhook(webhook, context.req.raw, at);
      return json(outcome.body, outcome.status, {});
    });
  }

  app.all("*", async (context) => {
    const at = context.get("at") ?? deps.clock.now();
    const traceId = context.get("trace") ?? "";
    const requestLogger: Logger = deps.logger.with({ traceId });

    const orpcContext: ApiContext = {
      request: context.req.raw,
      at,
      traceId,
      logger: requestLogger,
    };

    const { matched, response } = await handler.handle(context.req.raw, {
      prefix: "/",
      context: orpcContext,
    });

    if (matched) return response;
    return json({ error: "not_found", path: new URL(context.req.url).pathname }, 404, {});
  });

  /**
   * The last resort.
   *
   * A thrown error reaches here with no status attached — a driver failure, a
   * bug. It answers 500 with the trace id and nothing else: the message may
   * contain a failing statement and its parameters, which is exactly what a
   * database driver puts in one.
   */
  app.onError((cause, context) => {
    const traceId = context.get("trace") ?? "";
    deps.logger.error("unhandled error", {
      traceId,
      path: new URL(context.req.url).pathname,
      ...describeError(cause),
    });
    return json({ error: "internal_error", trace: traceId }, 500, {});
  });

  return app;
};
