/**
 * MembershipWriter — the two membership writes the console needs, over
 * better-auth's `member` table.
 *
 * `MembershipDirectory` stays read-only, and this is a second, deliberately
 * narrow interface rather than two methods added to it. The directory is read
 * on every authorized request and by billing; the writer is reached by two
 * contract routes and nothing else. Keeping them apart is what stops a use
 * case that was handed "who is a member" from also being handed "make them
 * one". There is still no `add`: the invitation flow is better-auth's own
 * HTTP surface, and the only way into a workspace.
 *
 * ### Why the write is ours rather than a call to the vendor's endpoint
 *
 * better-auth ships `/organization/update-member-role` and
 * `/organization/remove-member`. Both require the *acting user's session* —
 * `requireHeaders` plus the session middleware — so a service key, which has
 * no session and acts as the account that issued it, could never call either.
 * The contract makes both routes reachable with `workspace:admin`, which a
 * service key can hold. The endpoints are also read-then-write with no
 * transaction around the pair. So the adapter writes the row itself, inside
 * one transaction, and the rules the vendor would have enforced there are
 * enforced behind this port instead — once, in one place, and proven by the
 * contract suite every implementation runs.
 *
 * ### The rules
 *
 *   - **The last owner stays.** A workspace with no owner has nobody who can
 *     be billed, nobody who can invite, and no way back. Demoting or removing
 *     the only owner is `LastOwner`, whoever asks — including that owner.
 *   - **A member is a member.** Writing to somebody who does not belong is
 *     `NotAMember`, never a silent insert. An unknown workspace answers the
 *     same, for the same reason `MembershipDirectory` does.
 *   - **A change must change something.** Setting the role somebody already
 *     holds is `RoleUnchanged`: it is a console double-submit, and a 200 would
 *     hide it.
 *   - **`since` survives a role change.** The membership's start is when the
 *     person joined, not when they were last promoted.
 *
 * What the vendor's endpoints also do — refuse an admin who touches an owner
 * — is authorization's job and is done before either method is reached:
 * `workspace:admin` is held by owners alone (`@counted/authorization`).
 *
 * The failure kinds are spelled exactly as `@counted/tenancy-domain`'s
 * `WorkspaceError` spells them, on purpose. The contract's `reason` literals
 * are built from that union and the API maps refusals through one table; this
 * package cannot import that one, so the shapes are restated here and the
 * API relies on them being assignable. Renaming one here is a compile error
 * there, which is the property that matters.
 */

import type { AccountId, Result, Role, WorkspaceId } from "@counted/kernel";
import type { Membership } from "./membership-directory";

export type ChangeRoleFailure =
  | { readonly kind: "NotAMember"; readonly account: AccountId }
  | { readonly kind: "RoleUnchanged"; readonly account: AccountId; readonly role: Role }
  | { readonly kind: "LastOwner"; readonly account: AccountId };

export type RemoveMemberFailure =
  | { readonly kind: "NotAMember"; readonly account: AccountId }
  | { readonly kind: "LastOwner"; readonly account: AccountId };

export interface MembershipWriter {
  /**
   * Give `account` the role `role` in `workspace`, and answer the membership
   * as it now stands. Must agree with `MembershipDirectory` immediately: the
   * next `roleOf` returns `role`, and `membersOf` shows it with the original
   * `since`.
   */
  changeRole(
    workspace: WorkspaceId,
    account: AccountId,
    role: Role,
  ): Promise<Result<Membership, ChangeRoleFailure>>;

  /**
   * End `account`'s membership of `workspace`, and answer the membership that
   * was ended — the audit line wants to say what role left. Afterwards
   * `roleOf` is null and `membersOf` omits the account.
   */
  remove(workspace: WorkspaceId, account: AccountId): Promise<Result<Membership, RemoveMemberFailure>>;
}
