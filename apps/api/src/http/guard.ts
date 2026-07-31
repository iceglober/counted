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
import { Principal, decide, requirements, type Denial, type Facts, type Instant, type Scope } from "@counted/domain";
import type { AccessResolver, PresentedCredential } from "@counted/ports";
import type { ApiEnv } from "../server";
import type { Security } from "./route";
import { sendProblem } from "./respond";
import type { ErrorCode } from "@counted/contracts";

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
 * SDKs in the wild already send them, and a rewrite that breaks every deployed
 * client is not a rewrite anyone can ship.
 *
 * `?key=` is accepted **only for public ingest keys**, and only because
 * `navigator.sendBeacon` cannot set headers — it is the sole way to record an
 * event as a page is closing, which is exactly when the last event of a
 * session happens. The usual objection to keys in URLs is that they reach
 * access logs and browser history; an ingest key is already published in the
 * page's own JavaScript, so neither place is a new disclosure.
 *
 * A secret key in a query string is refused outright. That one would be a real
 * leak, and accepting it "just in case" is how it starts.
 */
const presented = (c: Context<ApiEnv>): string | null => {
  const authorization = c.req.header("authorization");
  if (authorization !== undefined) {
    const [scheme, value] = authorization.split(" ", 2);
    if (scheme?.toLowerCase() === "bearer" && value !== undefined && value.length > 0) return value;
    return null;
  }
  const header = c.req.header("app-key") ?? c.req.header("project-key");
  if (header !== undefined) return header;

  const query = c.req.query("key");
  if (query !== undefined && query.length > 0) {
    return claimedKind(query) === "ingest" ? query : null;
  }
  return null;
};

/**
 * Which error code a denial becomes.
 *
 * The split is about what the answer itself reveals, not about how severe the
 * refusal feels:
 *
 * **`auth.forbidden` (403)** — facts about the *caller*. `scope_not_granted`
 * describes the credential presented; `role_insufficient` is told only to
 * someone who is already a member, and therefore already knows the resource
 * exists. Neither discloses anything new.
 *
 * **`resource.not_found` (404)** — anything that would otherwise confirm a
 * resource exists. A caller outside the workspace must not be able to tell
 * "this belongs to someone else" from "no such thing", or a valid key becomes
 * an oracle for enumerating every other tenant's ids. Because the code decides
 * the status, the type URI and the title, the three cannot drift apart and
 * leave a subtler oracle behind.
 */
const CODE: Record<Denial["reason"], ErrorCode> = {
  anonymous: "auth.unauthenticated",
  scope_not_granted: "auth.forbidden",
  role_insufficient: "auth.forbidden",
  not_a_member: "resource.not_found",
  outside_binding: "resource.not_found",
  no_such_resource: "resource.not_found",
  // Our bug: the guard did not fetch a fact the decision needed.
  unresolved: "internal.error",
};

/**
 * What the client is told.
 *
 * Deliberately less than we know. A denial distinguishes seven cases
 * internally for logs; the response says which of three things happened. In
 * particular `outside_binding` and `not_a_member` read exactly as a missing
 * resource does, where they would otherwise confirm that some id exists.
 */
const detailFor = (denial: Denial): string | undefined => {
  switch (denial.reason) {
    case "scope_not_granted":
      return `This credential does not carry the ${denial.scope} scope.`;
    case "role_insufficient":
      return `A ${denial.role} may not ${denial.scope}.`;
    default:
      // The registry's own summary. One wording for all three 404 cases, so
      // there is nothing to compare.
      return undefined;
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

    const resolved = security.resource(c);
    if (resolved.kind === "misconfigured") {
      // The declaration names a path parameter this path does not have.
      return problem(c, { reason: "unresolved", fact: "placement" }, security.scope);
    }
    if (resolved.kind === "wrong_principal") {
      // A credential of the wrong kind for this route. Reported through the
      // same mapping as any other refusal, so an unauthenticated caller still
      // gets 401 with the challenge and an authenticated one gets 403.
      return problem(
        c,
        principal.kind === "anonymous"
          ? { reason: "anonymous" }
          : { reason: "scope_not_granted", scope: security.scope },
        security.scope,
      );
    }
    const resource = resolved.resource;

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
    if (!decision.allow) return problem(c, decision.denial, security.scope);

    await next();
    return;
  };

const problem = (c: Context<ApiEnv>, denial: Denial, scope?: Scope): Response => {
  // Logged with the precise reason; answered with the coarse one.
  c.get("log")?.warn("auth.denied", {
    reason: denial.reason,
    principalKind: c.get("principal")?.kind,
    route: c.req.routePath,
    ...(scope === undefined ? {} : { scope }),
  });
  return sendProblem(c, CODE[denial.reason], {
    ...(detailFor(denial) === undefined ? {} : { detail: detailFor(denial)! }),
    ...(scope === undefined ? {} : { scope }),
  });
};
