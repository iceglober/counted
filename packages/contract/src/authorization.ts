/**
 * One authorization declaration per procedure, and two things derived from it.
 *
 * v2 wrote security twice: an oRPC middleware decided access at runtime, and a
 * hand-maintained OpenAPI document said which schemes an operation accepted.
 * Nothing compared them, so `/v1/workspaces/{id}/credentials` was documented as
 * session-only for four months while a service key had been able to call it
 * since the day it shipped. A reader of the spec and a caller of the API had
 * different answers to the same question.
 *
 * Here a route declares its requirement once, as a value. From that one value:
 *
 *   1. the OpenAPI `security` block is computed and attached to the operation
 *      by the `spec` callback, together with an `x-counted-authorization`
 *      extension carrying the requirement itself, so the artifact is
 *      self-describing rather than merely plausible;
 *   2. `requirementFor(path)` hands the same value to the composition root in
 *      `apps/api`, which turns it into the `decide(principal, permission,
 *      placement, resource)` call that actually refuses the request.
 *
 * The contract does not *make* the decision — it may not import
 * `@counted/authorization` (it is a leaf) and it has no principal to decide
 * about. It states the requirement; `apps/api` enforces it. What this file
 * guarantees is that the statement and the enforcement read the same value.
 */

import type { Permission } from "@counted/kernel";

/**
 * The four credentials Counted actually issues.
 *
 * `consoleSession` is here because it is real. v2's document listed only the
 * two API-key schemes, which made every console-only route look unauthenticated
 * to anyone reading the spec.
 */
export type SecurityScheme = "consoleSession" | "serviceKey" | "ingestKey" | "shareToken" | "ingestBeacon";

export const SECURITY_SCHEMES: readonly SecurityScheme[] = [
  "consoleSession",
  "serviceKey",
  "ingestKey",
  "shareToken",
  "ingestBeacon",
];

/**
 * The kinds of thing a permission is checked against. Mirrors
 * `Resource` in `@counted/authorization`, which the contract may not import;
 * `apps/api` maps these strings onto that union in one place.
 */
export type ResourceType = "workspace" | "project" | "dashboard" | "monitor" | "credential";

export type AuthorizationRequirement =
  /**
   * No credential at all. Used by exactly one route — provisioning an
   * unclaimed project — because the no-signup path has nobody to authenticate
   * yet. Anything else that reaches for this is a mistake.
   */
  | { readonly kind: "anonymous" }
  /**
   * A share link. The token is the whole capability, and it reaches one
   * dashboard by identity — never by placement. `apps/api` resolves it through
   * `findByShareDigest` and checks the grant names the dashboard it returned.
   */
  | { readonly kind: "share" }
  /**
   * Any authenticated human. No permission, because there is no workspace yet
   * to hold one in — creating a workspace and reading your own account are the
   * only two such routes.
   */
  | { readonly kind: "account" }
  /**
   * Any live credential, whatever it can do. Used only by the route that tells
   * a key what it is, which is what an agent calls immediately after
   * provisioning.
   */
  | { readonly kind: "credential" }
  /**
   * A permission held anywhere the principal reaches; the route returns only
   * what is inside that reach. This is the listing case, where naming a single
   * resource up front would be a lie.
   */
  | { readonly kind: "principal"; readonly permission: Permission }
  /**
   * A permission on one named resource, whose id the request carries in
   * `param`.
   *
   * There is deliberately no second condition here — no `minimumRole` floor
   * beside the permission. A floor is a rule `decide` cannot express, so the
   * server had to run it as a separate check next to the decision, which is
   * two statements of one route's access rule with nothing comparing them.
   * Where a route needs more authority than a milder route sharing its
   * permission, the answer is its own permission: `projects:delete` is the
   * fifteenth, and the grant table already says only an owner holds it.
   */
  | {
      readonly kind: "resource";
      readonly permission: Permission;
      readonly resource: ResourceType;
      /** The input field holding the resource id. Must exist in the input schema. */
      readonly param: string;
    };

/**
 * Which credentials can satisfy a requirement — derived, never listed.
 *
 * The one interesting case is `events:write`. An ingest key holds exactly that
 * permission and nothing else, so it is the only permission for which an ingest
 * key is a possible answer. Deriving it means a future route that needs
 * `events:write` gets the ingest scheme automatically, and a route that does
 * not, cannot claim it.
 */
export const schemesFor = (
  requirement: AuthorizationRequirement,
): readonly SecurityScheme[] => {
  switch (requirement.kind) {
    case "anonymous":
      return [];
    case "share":
      return ["shareToken"];
    case "account":
      return ["consoleSession", "serviceKey"];
    case "credential":
      return ["serviceKey", "ingestKey"];
    case "principal":
    case "resource":
      return requirement.permission === "events:write"
        ? ["consoleSession", "serviceKey", "ingestKey"]
        : ["consoleSession", "serviceKey"];
  }
};

/**
 * The OpenAPI `security` value for a requirement.
 *
 * A list of alternatives: any one scheme suffices. An empty list is not the
 * same as an absent one — `security: []` says "this operation takes no
 * credential", which is the truth about provisioning and would otherwise be
 * read as "inherits the document default".
 */
export const securityFor = (
  requirement: AuthorizationRequirement,
): readonly Record<string, string[]>[] =>
  // Prefer bearer credentials in generated examples intended for integrations.
  // OpenAPI alternatives are ORed; their order does not change authorization.
  [...schemesFor(requirement)]
    .sort((a, b) => Number(b === "serviceKey") - Number(a === "serviceKey"))
    .map((scheme) => ({ [scheme]: [] }));

/**
 * The registry the composition root reads.
 *
 * Keyed by operation id, which is also the dotted path of the procedure in the
 * contract tree — `dashboards.list`, `tiles.add`. A test asserts the two agree
 * for every procedure and that the registry has no orphans, so a route cannot
 * be added without a requirement and a requirement cannot outlive its route.
 */
const registry = new Map<string, AuthorizationRequirement>();

export const declareRequirement = (id: string, requirement: AuthorizationRequirement): void => {
  const existing = registry.get(id);
  if (existing !== undefined) {
    // Two procedures sharing an operation id would silently give one of them
    // the other's security block. Fail at import, not at generation.
    throw new Error(`duplicate operation id: ${id}`);
  }
  registry.set(id, requirement);
};

/** Every declared requirement, by operation id. */
export const requirements: ReadonlyMap<string, AuthorizationRequirement> = registry;

/** The requirement for a procedure, addressed the way oRPC addresses it. */
export const requirementFor = (
  path: readonly string[],
): AuthorizationRequirement | undefined => registry.get(path.join("."));

/** The permission a requirement needs, or `null` where the kind implies none. */
export const permissionOf = (requirement: AuthorizationRequirement): Permission | null =>
  requirement.kind === "principal" || requirement.kind === "resource"
    ? requirement.permission
    : null;
