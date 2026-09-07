/**
 * The authorization function. The only one.
 *
 * It is pure: every fact arrives as a value, so there is no database call and
 * no clock inside a decision. That is what lets the whole principal × placement
 * matrix be tested exhaustively with no I/O, and it is why the sketch of an
 * `async authorize(…, ctx)` that fetched its own facts was not built — a
 * decision that can do I/O is a decision that can fail open when the I/O does.
 *
 * The caller's job is therefore load-bearing: resolve the placement of the
 * resource and, for a human, the role they hold IN THE WORKSPACE THAT OWNS IT,
 * then build the principal. `WorkspaceRole` carries the workspace with the
 * role so a role read in one workspace cannot decide a question about another.
 *
 * Three checks, always in this order:
 *
 *   1. authenticated at all
 *   2. does the principal hold the permission            (Q1 for humans)
 *   3. does its binding reach the resource               (Q2)
 *
 * Permission before binding, so a caller who is simply not allowed to do this
 * is told that, rather than being told the resource is somewhere else. Both
 * are 403 and neither reveals whether the resource exists, so the ordering is
 * about the operator reading the log, not about disclosure.
 */

import { assertNever, type AccountId, type Permission } from "@counted/kernel";
import { permits, permissionsForRole } from "./grants";
import { bindingOf, covers, type CoverageGap, type Placement, type Resource } from "./placement";
import type { Principal, WorkspaceRole } from "./principal";

export type Denial =
  /** No credential, or one that did not resolve. Maps to 401, with no detail. */
  | { readonly reason: "NotAuthenticated" }
  /**
   * Signed in, but not a member of the workspace that owns this. 403 with no
   * data — naming the workspace would confirm it exists.
   */
  | { readonly reason: "NotAMember"; readonly account: AccountId }
  /** A member, or a credential, that does not hold this permission. 403. */
  | { readonly reason: "NotPermitted"; readonly required: Permission }
  /** Holds the permission, but not over this resource. 403. */
  | {
      readonly reason: "OutOfBinding";
      readonly required: Permission;
      readonly resource: Resource;
      readonly gap: CoverageGap;
    };

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly denial: Denial };

const ALLOW: Decision = { allow: true };
const deny = (denial: Denial): Decision => ({ allow: false, denial });

/**
 * What this principal may do anywhere — before any question of where.
 *
 * A human's set is their role expanded through the grant table, computed per
 * decision rather than stored, so a role change takes effect on the next
 * request. A credential's set is its own, fixed at issuance: that is the point
 * of a key, and it is why revoking an admin does not silently widen the keys
 * they left behind.
 */
export const permissionsHeldBy = (principal: Principal): readonly Permission[] => {
  switch (principal.kind) {
    case "anonymous":
      return [];
    case "account":
      return principal.standing === null ? [] : permissionsForRole(principal.standing.role).filter((permission) => principal.permissionCeiling === undefined || principal.permissionCeiling.includes(permission));
    case "service":
    case "ingest":
    case "share":
      return principal.permissions;
    default:
      return assertNever(principal);
  }
};

const holds = (principal: Principal, permission: Permission): boolean => {
  if (principal.kind === "account") {
    // Straight to the grant table, so a role is never expanded into a list
    // that some later code could edit.
    return principal.standing !== null && permits(principal.standing.role, permission) && (principal.permissionCeiling === undefined || principal.permissionCeiling.includes(permission));
  }
  return permissionsHeldBy(principal).includes(permission);
};

/**
 * Q1 and Q2 together. `placement` is where the resource sits; `resource` is
 * what is being reached for.
 */
export const decide = (
  principal: Principal,
  permission: Permission,
  placement: Placement,
  resource: Resource,
): Decision => {
  if (principal.kind === "anonymous") return deny({ reason: "NotAuthenticated" });

  // Authenticated but not a member is its own answer. Folding it into
  // NotPermitted would be true — no membership means no role means no
  // permissions — but it would make the log useless for the one support
  // question this system actually gets: "why can't I see my workspace".
  if (principal.kind === "account" && principal.standing === null) {
    return deny({ reason: "NotAMember", account: principal.account });
  }

  if (!holds(principal, permission)) return deny({ reason: "NotPermitted", required: permission });

  const coverage = covers(bindingOf(principal), placement, resource);
  if (!coverage.covered) {
    return deny({ reason: "OutOfBinding", required: permission, resource, gap: coverage.gap });
  }

  return ALLOW;
};

/**
 * What a route needs when there is no resource to place.
 *
 * "List my workspaces" and "create a workspace" have nothing to pass `decide`:
 * the first is answered from membership and the second happens before any
 * membership exists. Before this existed the caller invented its own check —
 * a `reach.some(...)` in `apps/api` that expanded roles itself — which is a
 * second authorization policy living outside the one function that is supposed
 * to hold all of them.
 *
 * The three shapes are the only unplaced ones the contract can declare. Each
 * is a statement about the principal alone; none of them looks at a placement,
 * because there is nothing placed.
 */
export type UnplacedNeed =
  /**
   * Any principal that acts as a human account — a console session, or a
   * service key, which answers as the account that issued it. An ingest key
   * does not: there is no account behind it to act as.
   */
  | { readonly kind: "account" }
  /**
   * Any live credential, whatever it carries. One route is shaped this way —
   * the one that tells a key what it is — and it is what an agent calls
   * immediately after provisioning, holding a key and nothing else.
   */
  | { readonly kind: "credential" }
  /**
   * A permission held ANYWHERE the principal reaches, rather than over one
   * named resource. The route then returns only what is inside that reach,
   * which is why the standings are a parameter: the caller has already read
   * them and the decision must not read anything.
   */
  | { readonly kind: "permission"; readonly permission: Permission };

/**
 * Q1 with no placement, and no Q2 at all.
 *
 * `standings` is every workspace the caller was found to be a member of, with
 * the role held in each — the same list the route goes on to answer from. A
 * human holds the permission if any one of those roles holds it; a credential
 * holds what it carries, wherever it was issued. The default is an empty list,
 * which means "reaches nothing" and denies — a caller that forgot to resolve
 * the reach gets a refusal rather than a pass.
 */
export const decideUnplaced = (
  principal: Principal,
  need: UnplacedNeed,
  standings: readonly WorkspaceRole[] = [],
): Decision => {
  if (principal.kind === "anonymous") return deny({ reason: "NotAuthenticated" });

  switch (need.kind) {
    case "account":
      // Not `NotPermitted`: an ingest key has not failed a permission check,
      // it has failed to be the kind of thing this route can answer for.
      return principal.kind === "account" || principal.kind === "service"
        ? ALLOW
        : deny({ reason: "NotAuthenticated" });

    case "credential":
      return principal.kind === "service" || principal.kind === "ingest"
        ? ALLOW
        : deny({ reason: "NotAuthenticated" });

    case "permission": {
      if (principal.kind === "account") {
        // The principal's own standing counts too, so a caller that resolved
        // one workspace rather than a list still gets the right answer.
        const held = [
          ...standings,
          ...(principal.standing === null ? [] : [principal.standing]),
        ];
        return (principal.permissionCeiling === undefined || principal.permissionCeiling.includes(need.permission)) && held.some((standing) => permits(standing.role, need.permission))
          ? ALLOW
          : deny({ reason: "NotPermitted", required: need.permission });
      }
      return permissionsHeldBy(principal).includes(need.permission)
        ? ALLOW
        : deny({ reason: "NotPermitted", required: need.permission });
    }

    default:
      return assertNever(need);
  }
};

/** For call sites that only branch on the answer. */
export const allows = (d: Decision): d is { readonly allow: true } => d.allow;

/**
 * One line for an audit log. Contains no secret, no digest, and no id the
 * caller did not already supply.
 */
export const explain = (denial: Denial): string => {
  switch (denial.reason) {
    case "NotAuthenticated":
      return "not authenticated";
    case "NotAMember":
      return "not a member of the workspace that owns this resource";
    case "NotPermitted":
      return `missing permission ${denial.required}`;
    case "OutOfBinding":
      return `${denial.required} not reachable on ${denial.resource.type}: ${denial.gap}`;
    default:
      return assertNever(denial);
  }
};
