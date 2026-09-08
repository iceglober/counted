/**
 * MembershipDirectory — the anti-corruption layer over better-auth's member
 * table.
 *
 * This port keeps the domain independent of the identity adapter.
 * better-auth's organization plugin owns
 * `organization`, `member` and `invitation`, and it owns them in its own
 * tables. The domain reads membership through here and **never writes it**:
 * there is no `add`, because invitations are better-auth's own HTTP surface,
 * and there is no `remove` or `changeRole` on *this* interface. Those two live
 * on `MembershipWriter`, a separate port with its own contract suite, so that
 * a use case handed "who is a member" is not thereby handed "make them one".
 * `membership-writer.ts` says why the writes are ours rather than the
 * vendor's endpoints.
 *
 * A better-auth `organization` row and a domain `workspace` row have the same
 * id and different meanings: the organization answers "who belongs here, with
 * what role", the workspace answers "what plan, what limits, what is owed".
 * Both are real, neither should be deleted, and this port is the only place the
 * first one is visible.
 *
 * **`Role` is not defined here.** It lives in `@counted/kernel` because
 * `@counted/contract` needs the same word to emit OpenAPI security blocks and
 * may import nothing but the kernel. What this file adds is the mapping target:
 * `Membership` is the shape better-auth's `member` row is translated into, and
 * the translation is the adapter's only job.
 */

import type { AccountId, Instant, Role, WorkspaceId } from "@counted/kernel";

/**
 * One account's standing in one workspace.
 *
 * `since` is when the membership began, not when the row was last touched — a
 * role change keeps the original date, because "how long have they been here"
 * is the question it answers.
 */
export type Membership = {
  readonly account: AccountId;
  readonly role: Role;
  readonly since: Instant;
};

export interface MembershipDirectory {
  /**
   * The role this account holds in this workspace, or null if it holds none.
   *
   * Null means "not a member", which is the same amount of authority as
   * "member with no permissions" but a different fact — and the difference
   * matters at the audit line, where a non-member's attempt is worth logging.
   *
   * An unknown workspace and an unknown account both answer null rather than
   * throwing. A caller asking "may this person do this here" gets one answer
   * shape for every way the answer can be no, which is what keeps the
   * authorization path from growing a second error channel.
   */
  roleOf(account: AccountId, workspace: WorkspaceId): Promise<Role | null>;

  /**
   * Everyone in the workspace, with their roles: each account at most once, in
   * no guaranteed order, and empty for a workspace nobody belongs to or that
   * does not exist.
   *
   * Used to render the member list and to answer "is this the last owner"
   * before a role change — which better-auth enforces too, so this is the read
   * that lets the domain refuse with a good message instead of surfacing a
   * vendor error.
   *
   * Must agree with `roleOf`: if this returns a membership, `roleOf` for that
   * account returns the same role, and if it omits one, `roleOf` returns null.
   * Two reads of the same fact that can disagree is how a member list shows
   * somebody the permission check then refuses.
   */
  membersOf(workspace: WorkspaceId): Promise<readonly Membership[]>;
}
