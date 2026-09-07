/**
 * The one thing the workspace repository cannot answer on its own.
 *
 * `WorkspaceRepository.listForAccount` has to return a role, and roles live in
 * better-auth's `member` table — rows this package does not own, in a schema
 * better-auth generates and migrates. Two ways to get at them:
 *
 *   1. Join `auth.member` here. Free today, and silently wrong the first time
 *      better-auth renames a column or changes its casing convention: the join
 *      would not fail, it would return no rows, and the console would show an
 *      account with no workspaces. A user with no workspaces looks exactly like
 *      a new user.
 *   2. Ask whoever owns those rows. That is this.
 *
 * `MembershipDirectory` in `@counted/identity-ports` cannot be used directly —
 * it answers `roleOf(account, workspace)` and `membersOf(workspace)`, and this
 * needs the third direction, which no use case needed until now. Rather than
 * widen a port that belongs to another context from inside an adapter, the
 * lookup arrives as a function the composition root supplies over the
 * better-auth adapter.
 */

import type { AccountId, Role, WorkspaceId } from "@counted/kernel";

export type AccountMembership = {
  readonly workspace: WorkspaceId;
  readonly role: Role;
};

export interface WorkspaceMemberships {
  forAccount(account: AccountId): Promise<readonly AccountMembership[]>;
}

/**
 * An account that belongs to nothing.
 *
 * For a deployment — or a test — with no identity provider wired up yet.
 * Returning an empty list is honest here in a way it would not be in a real
 * lookup: this one has no rows to fail to find.
 */
export const noMemberships: WorkspaceMemberships = {
  forAccount: async () => [],
};
