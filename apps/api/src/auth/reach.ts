/**
 * The workspaces a caller reaches, and with what standing.
 *
 * Used by the three routes that answer "what can I see" — `account.me`,
 * `workspaces.list`, and every `principal`-kind requirement, which is
 * authorized on holding a permission *somewhere* rather than on one named
 * resource.
 *
 * **A credential's role is derived, never invented.** `WorkspaceSummary`
 * carries a role because a human has one; a key does not. The issuing account's
 * current role is used when they are still a member — that is the truthful
 * answer, and it is what an audit wants. When the issuer has left, the role
 * reported is the *lowest role in the grant table whose permissions contain
 * every permission the key carries*: a statement derived entirely from the
 * table, rather than v1's `role: "owner"` for every key regardless.
 *
 * A key outliving its issuer keeps working either way. Its permissions were
 * fixed at issuance and revoking a member does not silently widen or narrow
 * them; only the *description* of its standing degrades.
 */

import { ROLES, Role, type Permission, type Role as RoleName, type WorkspaceId } from "@counted/kernel";
import { permissionsForRole, type Principal } from "@counted/authorization";
import type { MembershipDirectory } from "@counted/identity-ports";
import type { WorkspaceSummary } from "@counted/tenancy-ports";

export type ReachReader = {
  /** Every workspace this account belongs to, with the role it holds in each. */
  workspacesFor(account: import("@counted/kernel").AccountId): Promise<readonly WorkspaceSummary[]>;
  workspaceName(workspace: WorkspaceId): Promise<string | null>;
};

export type ReachDeps = {
  readonly reach: ReachReader;
  readonly memberships: MembershipDirectory;
};

/**
 * The lowest role whose grants cover every permission held.
 *
 * `owner` when nothing covers them, which cannot happen today — owner holds
 * all fourteen — but is the safe direction to be wrong in for a *description*:
 * overstating the authority a key was issued with makes an operator look at it,
 * understating it makes them ignore it.
 */
export const roleCovering = (permissions: readonly Permission[]): RoleName => {
  for (const role of [...ROLES].sort((a, b) => Role.rank(a) - Role.rank(b))) {
    const held = new Set<Permission>(permissionsForRole(role));
    if (permissions.every((permission) => held.has(permission))) return role;
  }
  return "owner";
};

export const reachOf = async (
  deps: ReachDeps,
  principal: Principal,
): Promise<readonly WorkspaceSummary[]> => {
  switch (principal.kind) {
    case "anonymous":
      return [];

    case "account":
      return deps.reach.workspacesFor(principal.account);

    case "service":
    case "ingest": {
      const workspace = principal.kind === "service" ? principal.workspace : principal.workspace;
      if (workspace === null) return [];
      const name = await deps.reach.workspaceName(workspace);
      if (name === null) return [];
      const issuerRole =
        principal.kind === "service"
          ? await deps.memberships.roleOf(principal.onBehalfOf, workspace)
          : null;
      return [
        { id: workspace, name, role: issuerRole ?? roleCovering(principal.permissions) },
      ];
    }

    case "share":
      // A share link is a view of one page. It reaches no workspace, and
      // reporting the dashboard's would let a link enumerate its neighbours.
      return [];
  }
};
