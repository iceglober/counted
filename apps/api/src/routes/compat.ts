/**
 * The Aptabase-shaped door.
 *
 * A customer with Aptabase's SDK in a shipped mobile app cannot redeploy it to
 * try Counted. This endpoint accepts what that SDK already sends, translates
 * it, and runs **the same ingest path as `/v1/events`** — the same admission,
 * the same dedup, the same quota, the same writer. Nothing here decides
 * whether an event is stored.
 *
 * The translation itself is in `@counted/aptabase-compat`, and that is where
 * their vocabulary stops. `eventName`, `sessionId`, `systemProps` and `A-US-`
 * appear in this file only as things being converted; the domain never learns
 * any of them. v1 put Aptabase's field names in its database columns, so a
 * rename in their SDK would have been a migration in ours.
 *
 * Everything else under `/api/v0/` is `410 Gone` with a `Link` to the
 * successor. `404` would say "wrong URL"; these endpoints existed, and the
 * difference is what tells somebody to go and read the new spec.
 */

import { Principal, type ProjectId } from "@counted/domain";
import {
  accepted,
  badRequest,
  gone,
  looksLikeAptabaseKey,
  presentedKey,
  translate,
  tooLarge,
  unauthorized,
  type CompatResponse,
} from "@counted/aptabase-compat";
import type { Dependencies } from "../composition";
import { publicRoute, type RouteDefinition } from "../http/route";
import { ingestBatch, toSubmitted, MAX_BODY_BYTES } from "./ingest";

const send = (c: { newResponse: (body: string | null, status: number, headers: Record<string, string>) => Response }, r: CompatResponse): Response =>
  c.newResponse(r.body, r.status, r.headers);

/**
 * Resolve the presented key to a project, without the guard.
 *
 * The guard resolves a credential into a `Principal` and then authorizes a
 * *declared* scope against a *declared* resource. Both are right for `/v1`,
 * and both assume the caller speaks our error envelope — which an Aptabase
 * client does not. So this route is `publicRoute` and does the same two checks
 * itself, in the same order, answering in their shape.
 *
 * It is the same `access.principalFor`, so a revoked or expired key is refused
 * here exactly as it is on `/v1/events`.
 */
const projectFor = async (deps: Dependencies, key: string): Promise<ProjectId | null> => {
  const principal = await deps.access.principalFor(
    { digest: deps.secrets.digest(key), claimedKind: key.startsWith("ck") ? "ingest" : null },
    deps.clock.now(),
  );
  // Only an ingest credential may write events, here as anywhere. A service
  // key presented on this endpoint is refused rather than quietly widened.
  return principal.kind === "ingest" && principal.scopes.includes("events:write") ? principal.project : null;
};

const ingestHandler = (deps: Dependencies) => async (c: never): Promise<Response> => {
  const context = c as unknown as {
    req: { raw: Request; header: (name: string) => string | undefined; url: string; json: () => Promise<unknown> };
    get: (key: "log") => { info: (e: string, f?: object) => void; warn: (e: string, f?: object) => void };
    newResponse: (body: string | null, status: number, headers: Record<string, string>) => Response;
    set: (key: "principal", value: Principal) => void;
  };

  // Set so the request log attributes this the way every other request is
  // attributed, even though the guard did not run.
  context.set("principal", Principal.ANONYMOUS);

  const declared = context.req.header("content-length");
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) return send(context, tooLarge());

  const presented = presentedKey(context.req.raw.headers, new URL(context.req.url));
  if (presented === null) {
    return send(context, unauthorized("Missing App-Key header."));
  }

  const project = await projectFor(deps, presented.key);
  if (project === null) {
    // Named, because this is the one case where a useful sentence saves an
    // afternoon: an Aptabase key is a key we have never issued and never
    // could. Saying "invalid" would send somebody looking for a typo.
    return send(
      context,
      unauthorized(
        looksLikeAptabaseKey(presented.key)
          ? "This is an Aptabase app key. Counted issues its own ingest keys — create one and swap it in; the rest of your integration works unchanged."
          : "Invalid ingest key.",
      ),
    );
  }

  let raw: unknown;
  try {
    raw = await context.req.json();
  } catch {
    return send(context, badRequest("Body is not valid JSON."));
  }

  const translated = translate(raw);
  if (!translated.ok) return send(context, badRequest(translated.reason));

  // The same path `/v1/events` runs. Not a copy of it.
  const result = await ingestBatch(
    deps,
    project,
    translated.events.map((e) => toSubmitted(e as never)),
  );

  if (!result.ok) {
    context.get("log").warn("compat.unavailable", { projectId: project, reason: result.full ? "queue_full" : "write_failed" });
    // Their SDKs retry on 5xx, and every event carries a derived dedup key, so
    // a retry cannot double-count.
    return send(context, { status: 503, body: JSON.stringify({ error: "Temporarily unavailable" }), headers: { "content-type": "application/json", "retry-after": "5" } });
  }

  context.get("log").info("compat.receipt", {
    projectId: project,
    source: presented.source,
    accepted: result.accepted,
    deduplicated: result.deduplicated,
    rejected: result.rejected,
  });

  // Their shape: 200, empty. The receipt Counted computes is real and is in
  // the log, but a client written against Aptabase never reads a body and
  // would discard it.
  return send(context, accepted());
};

/** Paths that existed in v0 and no longer do. */
const REMOVED = [
  "/api/v0/events-list",
  "/api/v0/dashboard-data",
  "/api/v0/query",
  "/api/v0/usage",
  "/api/v0/projects",
  "/api/v0/dashboards",
  "/api/v0/alerts",
  "/api/v0/provision",
] as const;

export const compatRoutes = (deps: Dependencies): readonly RouteDefinition[] => [
  ...(["/api/v0/event", "/api/v0/events"] as const).map(
    (path): RouteDefinition => ({
      method: "post",
      path,
      security: publicRoute(
        "An Aptabase client cannot read our error envelope, so this door authenticates itself and answers in their shape.",
      ),
      handler: ingestHandler(deps) as unknown as RouteDefinition["handler"],
    }),
  ),

  ...REMOVED.flatMap((path): RouteDefinition[] =>
    (["get", "post"] as const).map((method) => ({
      method,
      path,
      security: publicRoute("Announcing a removal must not require a credential."),
      handler: (c) => {
        const response = gone(path);
        return (c as unknown as { newResponse: (b: string | null, s: number, h: Record<string, string>) => Response }).newResponse(
          response.body,
          response.status,
          response.headers,
        );
      },
    })),
  ),
];
