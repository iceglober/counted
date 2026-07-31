/**
 * Routes as data.
 *
 * Every route declares what it requires before it declares what it does. The
 * middleware reads that declaration and calls `decide` once; **no handler
 * calls the authorization function itself**. There is nowhere to put a
 * per-route ownership check, which is why v1's `ownedDashboard` — pasted
 * verbatim into two files, and subtly wrong in both — cannot recur.
 *
 * `public` is a variant that costs a written reason. Forgetting to authorize
 * is not expressible: the field is required, and the only way to skip the
 * check is to say, in the source, why this route is open. A census test then
 * asserts every route Hono knows about came through here.
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Resource, Scope } from "@counted/domain";
import type { ApiEnv } from "../server";

/**
 * What a route requires.
 *
 * `resource` is a function because the resource is usually named in the path
 * (`/v1/projects/:pid/...`), so it can only be read per-request.
 */
export type Security =
  | { readonly kind: "public"; readonly why: string }
  | {
      readonly kind: "scoped";
      readonly scope: Scope;
      readonly resource: (c: Context<ApiEnv>) => ResourceFor;
    };

/**
 * What a route's resource resolution produced.
 *
 * Three outcomes, because two of them used to be one `null` and they mean
 * opposite things. Collapsing them either turns our own misconfiguration into
 * a 403 the customer cannot act on, or turns a legitimate refusal into a 500
 * that pages someone.
 */
export type ResourceFor =
  | { readonly kind: "resource"; readonly resource: Resource }
  /**
   * This kind of principal cannot name a resource on this route — a service
   * key posting to the ingest endpoint, say. A refusal, not a bug.
   */
  | { readonly kind: "wrong_principal" }
  /**
   * The declaration names a path parameter the path pattern does not have.
   * Our bug, answered 500. v1's equivalent was `dashboard.projectId ?? ""`,
   * which sent an empty string to a uuid column, threw in Postgres, got
   * swallowed, and rendered a blank chart.
   */
  | { readonly kind: "misconfigured" };

export type Method = "get" | "post" | "patch" | "put" | "delete";

export type RouteDefinition = {
  readonly method: Method;
  /** The Hono path pattern, e.g. `/v1/projects/:projectId`. */
  readonly path: string;
  readonly security: Security;
  readonly handler: (c: Context<ApiEnv>) => Response | Promise<Response>;
};

/** A route that is open, and says why in one line that will end up in review. */
export const publicRoute = (why: string): Security => ({ kind: "public", why });

/** A route that requires `scope` on the resource named by the request. */
export const requires = (
  scope: Scope,
  resource: (c: Context<ApiEnv>) => ResourceFor,
): Security => ({ kind: "scoped", scope, resource });

/** Convenience for the common case: the resource is a path parameter. */
const fromPath =
  <T extends Resource["type"]>(type: T, param: string) =>
  (c: Context<ApiEnv>): ResourceFor => {
    const id = c.req.param(param);
    return id === undefined
      ? { kind: "misconfigured" }
      : { kind: "resource", resource: { type, id } as Resource };
  };

export const projectFromPath = (param = "projectId") => fromPath("project", param);
export const workspaceFromPath = (param = "workspaceId") => fromPath("workspace", param);
export const dashboardFromPath = (param = "dashboardId") => fromPath("dashboard", param);
export const monitorFromPath = (param = "monitorId") => fromPath("monitor", param);

/**
 * The project an ingest credential is bound to.
 *
 * Ingest names no project in its path — the key *is* the project. Deriving the
 * resource from the principal rather than from the URL means a caller cannot
 * name a project its key does not cover, and it keeps this route inside the
 * same authorization function as every other one: `decide` still checks the
 * scope and the binding, against a placement that is still looked up (so a
 * deleted or unclaimed project stops ingesting).
 */
export const ownProject = () => (c: Context<ApiEnv>): ResourceFor => {
  const principal = c.get("principal");
  return principal.kind === "ingest"
    ? { kind: "resource", resource: { type: "project", id: principal.project } }
    : { kind: "wrong_principal" };
};

/**
 * Mount route definitions onto an app, wrapping each in the guard.
 *
 * The guard runs per-route rather than as a global `app.use("*")` because a
 * global middleware cannot see which route matched, and would therefore have
 * to re-derive the requirement from the path — a second implementation of
 * routing, free to disagree with the first.
 */
export const mount = (
  app: Hono<ApiEnv>,
  routes: readonly RouteDefinition[],
  guard: (security: Security) => MiddlewareHandler<ApiEnv>,
): Hono<ApiEnv> => {
  for (const route of routes) {
    app[route.method](route.path, guard(route.security), route.handler);
  }
  return app;
};

/** Every route's declaration, for the census test and for `/v1/me`. */
export type CensusEntry = {
  readonly method: string;
  readonly path: string;
  readonly scope: Scope | null;
  readonly why: string | null;
};

export const census = (routes: readonly RouteDefinition[]): readonly CensusEntry[] =>
  routes.map((r) => ({
    method: r.method.toUpperCase(),
    path: r.path,
    scope: r.security.kind === "scoped" ? r.security.scope : null,
    why: r.security.kind === "public" ? r.security.why : null,
  }));
