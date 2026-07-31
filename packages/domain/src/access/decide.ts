/**
 * The authorization function. The only one.
 *
 * It is pure: facts arrive as values, so there is no database call and no
 * clock inside a decision. That is what lets every rule below be tested
 * exhaustively with no I/O, and it is why the sketch in the design doc — an
 * `async authorize(…, ctx)` that fetched its own facts — was not built.
 *
 * The obvious hazard of a pure decision is the caller: if it fetches the wrong
 * facts, `decide` sees `undefined` and the answer is wrong for a reason nobody
 * can see. Two things close that:
 *
 *   1. `requirements()` declares which facts a decision needs, and lives in
 *      this same file as the code that reads them. The caller fetches from the
 *      declaration rather than from memory.
 *   2. A missing required fact is `unresolved` — a distinct denial, never a
 *      quiet allow and never indistinguishable from "not a member".
 *
 * A test wraps the facts in a recording proxy and asserts that everything
 * `decide` reads was declared, so the two cannot drift apart.
 */

import type { ProjectId, WorkspaceId } from "../shared/ids";
import type { Role } from "../workspace/membership";
import type { Principal } from "./principal";
import type { Scope } from "./scope";
import { roleGrants } from "./scope";

/**
 * Where a resource sits in the tenancy tree.
 *
 * Every resource resolves to a workspace, and the project-scoped ones also to
 * a project. This is the single fact that replaces v1's per-route ownership
 * joins, each written slightly differently.
 */
export type Placement = {
  /**
   * The workspace that owns the resource, or `null` when nothing does yet.
   *
   * An unclaimed project is the only thing that can be placed nowhere: it
   * exists, it has an id, and its ingest key works — that is the whole of the
   * no-signup path — but no membership reaches it, because there is no
   * workspace for anyone to be a member of.
   *
   * This being nullable rather than the placement being `null` is the
   * difference between "no such project" and "a project nobody owns yet".
   * Collapsing them made an unclaimed project's own key answer 404, which
   * silently broke onboarding: the key handed out by `/v1/provision` could not
   * send a single event.
   */
  readonly workspace: WorkspaceId | null;
  readonly project: ProjectId | null;
};

export type Resource =
  | { readonly type: "workspace"; readonly id: WorkspaceId }
  | { readonly type: "project"; readonly id: ProjectId }
  | { readonly type: "dashboard"; readonly id: string }
  | { readonly type: "monitor"; readonly id: string }
  | { readonly type: "credential"; readonly id: string };

/**
 * The facts a decision may consult.
 *
 * `undefined` means the caller did not supply it — a bug, reported as
 * `unresolved`. `null` means it was looked up and does not exist: no such
 * resource, or no membership. Those are different answers and are kept apart.
 */
export type Facts = {
  readonly placement?: Placement | null;
  readonly role?: Role | null;
};

/** Which facts must be resolved before `decide` is called. */
export type Requirement = {
  readonly placement: boolean;
  readonly role: boolean;
};

export type Denial =
  | { readonly reason: "anonymous" }
  | { readonly reason: "unresolved"; readonly fact: "placement" | "role" }
  | { readonly reason: "no_such_resource" }
  | { readonly reason: "not_a_member" }
  | { readonly reason: "role_insufficient"; readonly role: Role; readonly scope: Scope }
  | { readonly reason: "scope_not_granted"; readonly scope: Scope }
  | { readonly reason: "outside_binding" };

export type Decision = { readonly allow: true } | { readonly allow: false; readonly denial: Denial };

const ALLOW: Decision = { allow: true };
const deny = (denial: Denial): Decision => ({ allow: false, denial });

/**
 * What must be fetched before deciding, given who is asking.
 *
 * Only the principal kind matters. A human's authority comes from membership,
 * so both the resource's placement and their role in it are needed. A
 * credential's authority is its own scopes plus its binding, so placement is
 * needed but a role is not — which is the point of a key: it does not inherit
 * whatever its issuer can do today.
 */
export const requirements = (principal: Principal): Requirement => {
  switch (principal.kind) {
    case "anonymous":
    case "worker":
      return { placement: false, role: false };
    case "account":
      return { placement: true, role: true };
    case "ingest":
    case "service":
    case "share":
      return { placement: true, role: false };
  }
};

/** True when the resource named is the one this credential is bound to. */
const boundToProject = (placement: Placement, project: ProjectId): boolean =>
  placement.project === project;

export const decide = (
  principal: Principal,
  scope: Scope,
  resource: Resource,
  facts: Facts,
): Decision => {
  if (principal.kind === "anonymous") return deny({ reason: "anonymous" });

  // The worker runs on the private network and is not bound to a tenant; it
  // holds internal scopes and nothing else. It never sees a user's request.
  if (principal.kind === "worker") {
    return principal.scopes.includes(scope) ? ALLOW : deny({ reason: "scope_not_granted", scope });
  }

  const placement = facts.placement;
  if (placement === undefined) return deny({ reason: "unresolved", fact: "placement" });
  if (placement === null) return deny({ reason: "no_such_resource" });

  if (principal.kind === "account") {
    // Nothing owns it, so no membership can reach it. An unclaimed project is
    // adopted through a claim grant, never through authorization.
    if (placement.workspace === null) return deny({ reason: "not_a_member" });

    const role = facts.role;
    if (role === undefined) return deny({ reason: "unresolved", fact: "role" });
    // Not a member of the workspace that owns this. Note this is decided from
    // membership, never from a `userId` column on the row — which is how v1
    // let a dashboard with a NULL owner be edited by anybody.
    if (role === null) return deny({ reason: "not_a_member" });
    return roleGrants(role, scope) ? ALLOW : deny({ reason: "role_insufficient", role, scope });
  }

  // Every remaining kind is a credential: it may do what its own scopes say,
  // and only inside its binding. Both are checked, always in that order, so a
  // scope error is not reported as a missing resource.
  if (!principal.scopes.includes(scope)) return deny({ reason: "scope_not_granted", scope });

  switch (principal.kind) {
    case "ingest":
      return boundToProject(placement, principal.project) ? ALLOW : deny({ reason: "outside_binding" });

    case "share":
      // Bound to one dashboard. Reading anything else, including a different
      // dashboard in the same project, is outside the binding — a share link
      // is a view of one page, not a guest account.
      if (resource.type === "dashboard") {
        return resource.id === principal.dashboard ? ALLOW : deny({ reason: "outside_binding" });
      }
      return placement.project !== null && principal.projects.includes(placement.project)
        ? ALLOW
        : deny({ reason: "outside_binding" });

    case "service": {
      // A service key is bound to a workspace, so an unowned project is
      // outside every one of them.
      if (placement.workspace === null || placement.workspace !== principal.workspace) {
        return deny({ reason: "outside_binding" });
      }
      if (principal.projects === "all") return ALLOW;
      // A key narrowed to some projects may still act on the workspace itself
      // only where no project is involved; anything project-scoped must be in
      // its list.
      if (placement.project === null) return ALLOW;
      return principal.projects.includes(placement.project) ? ALLOW : deny({ reason: "outside_binding" });
    }
  }
};

/** Convenience for call sites that only branch on the answer. */
export const allows = (d: Decision): d is { allow: true } => d.allow;
