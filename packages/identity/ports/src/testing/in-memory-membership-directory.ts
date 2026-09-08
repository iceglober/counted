/**
 * A MembershipDirectory and MembershipWriter backed by a Map of Maps.
 *
 * `join` and `leave` are on the fake, not on either port: they stand in for
 * better-auth's invitation flow, which is the only thing allowed to admit
 * somebody for real, and keeping them off the ports is what stops a use case
 * reaching for one. `changeRole` and `remove` are the port's, and enforce the
 * same rules the real adapter does — the writer contract runs against both.
 */

import { err, ok, type AccountId, type Instant, type Role, type WorkspaceId } from "@counted/kernel";
import type { Membership, MembershipDirectory } from "../membership-directory";
import type { MembershipWriter } from "../membership-writer";

export type InMemoryMembershipDirectory = MembershipDirectory &
  MembershipWriter & {
    /** Add or re-role. A re-role keeps the original `since`, as better-auth does. */
    join(workspace: WorkspaceId, account: AccountId, role: Role, since: Instant): void;
    leave(workspace: WorkspaceId, account: AccountId): void;
    clear(): void;
  };

export const inMemoryMembershipDirectory = (): InMemoryMembershipDirectory => {
  const byWorkspace = new Map<WorkspaceId, Map<AccountId, Membership>>();

  const owners = (members: ReadonlyMap<AccountId, Membership>): number =>
    [...members.values()].filter((m) => m.role === "owner").length;

  return {
    join(workspace, account, role, since) {
      let members = byWorkspace.get(workspace);
      if (members === undefined) {
        members = new Map<AccountId, Membership>();
        byWorkspace.set(workspace, members);
      }
      const existing = members.get(account);
      members.set(account, { account, role, since: existing?.since ?? since });
    },
    leave(workspace, account) {
      byWorkspace.get(workspace)?.delete(account);
    },
    clear() {
      byWorkspace.clear();
    },
    async roleOf(account, workspace) {
      return byWorkspace.get(workspace)?.get(account)?.role ?? null;
    },
    async membersOf(workspace) {
      const members = byWorkspace.get(workspace);
      return members === undefined ? [] : [...members.values()];
    },
    async changeRole(workspace, account, role) {
      const members = byWorkspace.get(workspace);
      const existing = members?.get(account);
      if (members === undefined || existing === undefined) return err({ kind: "NotAMember", account });
      if (existing.role === role) return err({ kind: "RoleUnchanged", account, role });
      if (existing.role === "owner" && owners(members) <= 1) return err({ kind: "LastOwner", account });
      const changed: Membership = { account, role, since: existing.since };
      members.set(account, changed);
      return ok(changed);
    },
    async remove(workspace, account) {
      const members = byWorkspace.get(workspace);
      const existing = members?.get(account);
      if (members === undefined || existing === undefined) return err({ kind: "NotAMember", account });
      if (existing.role === "owner" && owners(members) <= 1) return err({ kind: "LastOwner", account });
      members.delete(account);
      return ok(existing);
    },
  };
};
