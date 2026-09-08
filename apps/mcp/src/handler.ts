/**
 * The HTTP face: routing, the 401 that starts the OAuth flow, and the MCP
 * handler itself.
 *
 * Four routes and nothing else.
 *
 *   GET  /.well-known/oauth-protected-resource[/path]  RFC 9728 metadata
 *   ANY  <endpoint>                                    the MCP endpoint
 *   GET  /health                                       liveness
 *   GET  /health/ready                                 readiness
 *
 * Readiness and liveness answer the same thing here, and that is not a
 * shortcut: this process holds no database and no state, and the only thing
 * that can fail at boot — projecting the contract into tools — throws at
 * import, before the port is bound. Both paths exist because the deployment
 * (`deploy/mcp.railway.json`) names `/health/ready`, the same path the API is
 * checked on, and a check that points at a path nobody serves waits out its
 * timeout and then reports healthy anyway.
 *
 * The endpoint requires a bearer even though one exposed tool
 * (`projects.provision`) needs no credential. That is a deliberate trade: an
 * MCP client only starts an authorization flow when it sees a `401` with a
 * `WWW-Authenticate` challenge, so an endpoint that quietly serves
 * unauthenticated requests is an endpoint nobody ever authenticates to — and
 * every other tool would then fail one at a time with an error the client
 * cannot act on. Provisioning without an account stays available over HTTP,
 * which is where the no-signup path actually lives.
 */

import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import {
  bearerOf,
  challengeResponse,
  metadataPathFor,
  protectedResourceMetadata,
  type ResourceIdentity,
  type TokenVerifier,
} from "./authentication";
import type { ContractInvoker } from "./invoke";
import { buildServer } from "./server";

export type HandlerOptions = {
  readonly identity: ResourceIdentity;
  readonly endpoint: string;
  readonly verifier: TokenVerifier;
  readonly invoker: ContractInvoker;
  readonly onError?: (error: Error) => void;
};

/** Liveness: the process is up. Answers from memory and touches nothing. */
export const HEALTH_PATH = "/health";
/** Readiness: the path the deployment's health check names. See the note above. */
export const READY_PATH = "/health/ready";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Builds the fetch handler.
 *
 * `createMcpHandler` calls the factory once per HTTP request, which is exactly
 * the lifetime the token has — so binding the tools to the caller's token in
 * the closure is not a shortcut, it is the same scope the SDK already uses.
 */
export const createHandler = (options: HandlerOptions): {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
} => {
  const metadataPath = metadataPathFor(options.identity.resource);

  const handler: McpHttpHandler = createMcpHandler(
    // The factory runs once per HTTP request and is handed that request, so the
    // token is read from the header again rather than smuggled across in a map
    // keyed by object identity — the SDK is free to hand us a different Request
    // instance and nothing here would notice until a caller's token went
    // missing in production.
    (ctx) =>
      buildServer({
        invoker: options.invoker,
        token: ctx.requestInfo === undefined ? undefined : bearerOf(ctx.requestInfo),
      }),
    {
      // Modern-only. The 2026-07-28 profile is what the assignment asks for,
      // and serving the 2025 era as well would mean two code paths whose
      // authentication behaviour has to be argued about twice.
      legacy: "reject",
      ...(options.onError === undefined ? {} : { onerror: options.onError }),
    },
  );

  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if ((request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === metadataPath || url.pathname === "/.well-known/oauth-protected-resource")) {
      const response = json(protectedResourceMetadata(options.identity));
      return request.method === "HEAD" ? new Response(null, { headers: response.headers }) : response;
    }

    if (request.method === "GET" && url.pathname === HEALTH_PATH) {
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === READY_PATH) {
      return json({ ready: true });
    }

    if (url.pathname !== options.endpoint) {
      return json({ error: "not_found" }, 404);
    }

    const token = bearerOf(request);
    if (token === undefined) {
      return challengeResponse(options.identity, {
        code: "invalid_request",
        description: "This endpoint needs an OAuth access token bound to it.",
      });
    }

    const verdict = await options.verifier.verify(token);
    if (verdict.kind === "rejected") {
      return challengeResponse(options.identity, {
        code: "invalid_token",
        description: verdict.because,
      });
    }
    if (verdict.kind === "unreachable") {
      // Not a 401. Telling a client to re-authenticate because the API is down
      // sends it round an authorization loop that cannot succeed.
      return json(
        { error: "temporarily_unavailable", error_description: verdict.because },
        503,
      );
    }

    return handler.fetch(request);
  };

  return { fetch, close: () => handler.close() };
};
