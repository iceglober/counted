/**
 * The one place a request is authenticated and authorized.
 *
 * It does four things in a fixed order, and no handler repeats any of them:
 *
 *   1. Read the presented credential and resolve it to a principal.
 *   2. Ask the domain which facts this principal's decision needs.
 *   3. Fetch exactly those facts.
 *   4. Call `decide` once, and turn a denial into problem+json.
 *
 * Step 2 is what stops this file and the domain drifting apart: the fetch list
 * is read from `requirements()` rather than remembered here.
 *
 * v1 had seven authentication modes and four authorization implementations,
 * and `unauthorized()` was called in one of roughly twenty places that needed
 * it.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import { Principal, decide, requirements, type Denial, type Facts, type Instant } from "@counted/domain";
import type { AccessResolver, PresentedCredential } from "@counted/ports";
import type { ApiEnv } from "../server";
import type { Security } from "./route";

export type GuardDeps = {
  readonly access: AccessResolver;
  readonly digest: (secret: string) => string;
  readonly now: () => Instant;
};

/** Prefix → claimed kind. A hint for the lookup; authority comes from the row. */
const claimedKind = (secret: string): PresentedCredential["claimedKind"] => {
  const prefix = secret.split("_", 1)[0];
  if (prefix === "ck") return "ingest";
  if (prefix === "sk") return "service";
  if (prefix === "st") return "share";
  return null;
};

/**
 * Where the secret may appear.
 *
 * `Authorization: Bearer` is canonical. The two header aliases exist because
 * SDKs in the wild already send them and a rewrite that breaks every deployed
 * client is not a rewrite anyone can ship. A query parameter is deliberately
 * *not* accepted: URLs end up in access logs and browser history.
 */
const presented = (c: Context<ApiEnv>): string | null => {
  const authorization = c.req.header("authorization");
  if (authorization !== undefined) {
    const [scheme, value] = authorization.split(" ", 2);
    if (scheme?.toLowerCase() === "bearer" && value !== undefined && value.length > 0) return value;
    return null;
  }
  return c.req.header("app-key") ?? c.req.header("project-key") ?? null;
};

/**
 * Which HTTP status a denial becomes.
 *
 * The split is about what the answer itself reveals, not about how severe the
 * refusal feels:
 *
 * **403** — facts about the *caller*. `scope_not_granted` describes the
 * credential presented; `role_insufficient` is told only to someone who is
 * already a member, and therefore already knows the resource exists. Neither
 * discloses anything new.
 *
 * **404** — anything that would otherwise confirm a resource exists. A caller
 * outside the workspace must not be able to tell "this project belongs to
 * someone else" from "no such project", or a valid key becomes an oracle for
 * enumerating every other tenant's ids.
 */
const STATUS: Record<Denial["reason"], number> = {
  // No usable credential. 401 invites the client to present one.
  anonymous: 401,
  scope_not_granted: 403,
  role_insufficient: 403,
  not_a_member: 404,
  outside_binding: 404,
  no_such_resource: 404,
  // Our bug: the guard did not fetch a fact the decision needed.
  unresolved: 500,
};

/**
 * The problem type the client sees.
 *
 * Several internal reasons collapse to one URI on purpose. The denial keeps
 * eight cases so a log line can say precisely what happened; the response
 * carries three, because a distinct `type` is as good an oracle as a distinct
 * status — matching statuses with differing type URIs would have left the
 * enumeration hole open in a subtler place.
 */
const PUBLIC_TYPE: Record<Denial["reason"], string> = {
  anonymous: "unauthenticated",
  scope_not_granted: "forbidden",
  role_insufficient: "forbidden",
  not_a_member: "not-found",
  outside_binding: "not-found",
  no_such_resource: "not-found",
  unresolved: "internal-error",
};

const TITLE: Record<Denial["reason"], string> = {
  anonymous: "Unauthenticated",
  scope_not_granted: "Forbidden",
  role_insufficient: "Forbidden",
  not_a_member: "Not Found",
  outside_binding: "Not Found",
  no_such_resource: "Not Found",
  unresolved: "Internal Server Error",
};

/**
 * What the client is told.
 *
 * Deliberately less than we know. A denial distinguishes eight cases
 * internally for logs; the response says which of three things happened. In
 * particular `outside_binding` and `not_a_member` are reported the same way a
 * missing resource is where they would otherwise confirm that some id exists.
 */
const detailFor = (denial: Denial): string => {
  switch (denial.reason) {
    case "anonymous":
      return "No credential was presented, or it is not valid.";
    case "scope_not_granted":
      return `This credential does not carry the ${denial.scope} scope.`;
    case "role_insufficient":
      return `A ${denial.role} may not ${denial.scope}.`;
    case "not_a_member":
    case "outside_binding":
    case "no_such_resource":
      return "No such resource, or it is not yours.";
    case "unresolved":
      return "The request could not be authorized.";
  }
};

export const createGuard =
  (deps: GuardDeps) =>
  (security: Security): MiddlewareHandler<ApiEnv> =>
  async (c: Context<ApiEnv>, next: Next) => {
    const secret = presented(c);
    const principal =
      secret === null
        ? Principal.ANONYMOUS
        : await deps.access.principalFor(
            { digest: deps.digest(secret), claimedKind: claimedKind(secret) },
            deps.now(),
          );

    // Set before the check, so even a denied request is attributable in logs.
    c.set("principal", principal);

    if (security.kind === "public") {
      await next();
      return;
    }

    const resource = security.resource(c);
    if (resource === null) {
      // The declaration names a path parameter this path does not have.
      return problem(c, { reason: "unresolved", fact: "placement" });
    }

    // Ask the domain what it needs, then fetch precisely that. Anything not
    // required stays absent rather than being fetched "just in case" — an
    // unnecessary membership lookup on every ingest request is a real cost at
    // ingest volume.
    const needs = requirements(principal);
    const facts: { placement?: Awaited<ReturnType<AccessResolver["placementOf"]>>; role?: Awaited<ReturnType<AccessResolver["roleOf"]>> } = {};
    if (needs.placement) facts.placement = await deps.access.placementOf(resource);
    if (needs.role) {
      const account = principal.kind === "account" ? principal.account : null;
      const workspace = facts.placement?.workspace ?? null;
      facts.role = account !== null && workspace !== null ? await deps.access.roleOf(account, workspace) : null;
    }

    const decision = decide(principal, security.scope, resource, facts as Facts);
    if (!decision.allow) return problem(c, decision.denial);

    await next();
    return;
  };

const problem = (c: Context<ApiEnv>, denial: Denial): Response => {
  const status = STATUS[denial.reason];
  if (status === 401) {
    // RFC 9728: tell the client how to authenticate rather than making it
    // guess from documentation.
    c.header("www-authenticate", 'Bearer realm="counted"');
  }
  return c.json(
    {
      type: `https://counted.dev/problems/${PUBLIC_TYPE[denial.reason]}`,
      title: TITLE[denial.reason],
      status,
      detail: detailFor(denial),
      requestId: c.get("requestId"),
    },
    status as 401 | 403 | 404 | 500,
  );
};
