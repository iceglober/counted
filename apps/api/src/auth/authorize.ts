/**
 * The one place a request is allowed or refused.
 *
 * `@counted/contract` states each procedure's requirement as a value and emits
 * the OpenAPI `security` block from it. This reads the *same value* back with
 * `requirementFor(path)` and turns it into the decision. One declaration, two
 * outputs — which is the property v2 did not have: its document said
 * `/v1/workspaces/{id}/credentials` was session-only for four months while a
 * service key had been able to call it since the day it shipped.
 *
 * The order is fixed and each step exists for a reason:
 *
 *   1. resolve the credential                    — who
 *   2. resolve the resource and its placement    — where it sits
 *   3. read the caller's role IN THAT WORKSPACE  — a role is never carried
 *   4. `decide(principal, permission, placement, resource)` — Q1 then Q2
 *
 * Routes with no resource to place — "list my workspaces", "create a
 * workspace", "what is this key" — go to `decideUnplaced` instead. They used to
 * be answered here, with a `reach.some(permissionsForRole(...))` written out
 * in this file, which is a second authorization policy sitting next to the
 * one. Every branch below now ends in a decision this file did not make.
 *
 * Step 3 is why `standing` is null when a principal is first built. A role read
 * in workspace A deciding a question about workspace B is the failure
 * `WorkspaceRole` exists to prevent, and the only way to make it unrepresentable
 * is to not have the role until the workspace is known.
 *
 * Use cases never repeat this. `@counted/authorization` is not on their import
 * list (`.dependency-cruiser.cjs`, rule 2), so a second policy cannot quietly
 * appear next to this one.
 */

import { assertNever, type Instant } from "@counted/kernel";
import {
  decide,
  decideUnplaced,
  Principal,
  type Denial,
  type WorkspaceRole,
} from "@counted/authorization";
import type { AuthorizationRequirement } from "@counted/contract";
import type { WorkspaceSummary } from "@counted/tenancy-ports";
import { fromDashboardError, fromDenial, type Fault } from "../faults";
import { locate, type Located, type PlacementReader } from "./placement";
import { resolvePrincipal, standingIn, type PrincipalDeps } from "./principal";
import { reachOf, type ReachDeps } from "./reach";

/** What a handler is handed once the decision has been made. */
export type Authority = {
  readonly principal: Principal;
  /** The resource named in the path, for requirements that name one. */
  readonly located: Located | null;
  /**
   * Every workspace the caller reaches. Populated only where the route needs
   * it — a listing route, or one authorized on a permission held anywhere —
   * because it costs a query and most routes name their workspace.
   */
  readonly reach: readonly WorkspaceSummary[];
  readonly at: Instant;
};

export type AuthorizeDeps = PrincipalDeps &
  ReachDeps & {
    readonly placements: PlacementReader;
  };

export type Authorization =
  | { readonly ok: true; readonly authority: Authority }
  | {
      readonly ok: false;
      readonly fault: Fault;
      /** Null when the request failed before a decision was reached. */
      readonly denial: Denial | null;
      /** Carried so the audit line names who was refused, not just what. */
      readonly principal: Principal;
    };

const refuse = (principal: Principal, denial: Denial): Authorization => ({
  ok: false,
  fault: fromDenial(denial),
  denial,
  principal,
});

const reject = (principal: Principal, fault: Fault): Authorization => ({
  ok: false,
  fault,
  denial: null,
  principal,
});

/**
 * The share token this request carries, if the route declares one.
 *
 * Read from the validated input rather than the URL, so a token cannot
 * authenticate a route that never asked for one.
 */
const shareTokenOf = (
  requirement: AuthorizationRequirement,
  input: unknown,
): string | null => {
  if (requirement.kind !== "share") return null;
  const token = (input as { shareToken?: unknown } | null)?.shareToken;
  return typeof token === "string" && token.length > 0 ? token : null;
};

/** The id the route carries for a `resource` requirement. */
const paramOf = (param: string, input: unknown): string | null => {
  const value = (input as Record<string, unknown> | null)?.[param];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * The workspaces a caller reaches, as standings a decision can read.
 *
 * `WorkspaceSummary` is a listing row — it carries a name, for the console.
 * `WorkspaceRole` is the pair a decision needs and nothing more, which is what
 * keeps `decideUnplaced` from being handed a display concern.
 */
const standingsIn = (reach: readonly WorkspaceSummary[]): readonly WorkspaceRole[] =>
  reach.map((summary) => ({ workspace: summary.id, role: summary.role }));

export const authorize = async (
  deps: AuthorizeDeps,
  requirement: AuthorizationRequirement,
  headers: Headers,
  input: unknown,
  at: Instant,
): Promise<Authorization> => {
  const resolved = await resolvePrincipal(
    deps,
    headers,
    at,
    shareTokenOf(requirement, input),
  );
  if (!resolved.ok) return reject(Principal.ANONYMOUS, resolved.fault);

  const principal = resolved.principal;

  switch (requirement.kind) {
    case "anonymous":
      // The only route shaped this way is provisioning, which has nobody to
      // authenticate yet. A principal is still resolved, so a caller who did
      // present a key is recorded as themselves in the audit line.
      return allow(deps, principal, null, at, false);

    case "share": {
      if (principal.kind !== "share") {
        // A wrong token, an unshared dashboard and a missing token are one
        // answer. A distinct status for any of them turns the endpoint into an
        // oracle for which dashboards have live links.
        return reject(principal, fromDashboardError({ kind: "NotShared" }));
      }
      return allow(deps, principal, null, at, false);
    }

    case "account": {
      // A service key answers as the account that issued it, which is what
      // makes an audit trail possible without a session. An ingest key does
      // not: it has no account behind it at all. `decideUnplaced` says so, so
      // this file does not.
      const decision = decideUnplaced(principal, { kind: "account" });
      if (!decision.allow) return refuse(principal, decision.denial);
      return allow(deps, principal, null, at, true);
    }

    case "credential": {
      const decision = decideUnplaced(principal, { kind: "credential" });
      if (!decision.allow) return refuse(principal, decision.denial);
      return allow(deps, principal, null, at, false);
    }

    case "principal": {
      // Q1 only, and deliberately: there is no named resource to place. The
      // route returns what is inside the caller's reach, which is why `reach`
      // is computed here and handed on rather than recomputed in the handler —
      // and why the decision is made from it rather than beside it.
      const reach = await reachOf(deps, principal);
      const decision = decideUnplaced(
        principal,
        { kind: "permission", permission: requirement.permission },
        standingsIn(reach),
      );
      if (!decision.allow) return refuse(principal, decision.denial);
      return { ok: true, authority: { principal, located: null, reach, at } };
    }

    case "resource": {
      const raw = paramOf(requirement.param, input);
      if (raw === null) {
        // The contract guarantees every `{param}` is a required input field, so
        // this is a contract/route mismatch rather than a bad request. Saying
        // so as a 500 keeps it from being blamed on the caller.
        return reject(principal, {
          code: "INTERNAL_SERVER_ERROR",
          message: "The route does not carry the field its authorization names.",
          data: { reason: "MissingAuthorizationParam", param: requirement.param },
        });
      }

      const location = await locate(deps.placements, requirement.resource, raw);
      if (!location.ok) return reject(principal, location.fault);

      const placed = await standingIn(deps, principal, location.located.placement.workspace);
      const decision = decide(
        placed,
        requirement.permission,
        location.located.placement,
        location.located.resource,
      );
      if (!decision.allow) return refuse(placed, decision.denial);

      return {
        ok: true,
        authority: { principal: placed, located: location.located, reach: [], at },
      };
    }

    default:
      return assertNever(requirement);
  }
};

const allow = async (
  deps: AuthorizeDeps,
  principal: Principal,
  located: Located | null,
  at: Instant,
  withReach: boolean,
): Promise<Authorization> => ({
  ok: true,
  authority: {
    principal,
    located,
    reach: withReach ? await reachOf(deps, principal) : [],
    at,
  },
});
