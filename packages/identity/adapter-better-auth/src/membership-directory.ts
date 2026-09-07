/**
 * `MembershipDirectory` over the organization plugin's `member` table.
 *
 * Read-only. There is no `add`, because invitations are better-auth's own
 * HTTP surface; `remove` and `changeRole` are `membership-writer.ts`, which
 * reads rows exactly the way this file does so that the two can never
 * disagree about who is here.
 *
 * The whole translation is `roleFrom`. Everything else is two queries.
 */

import { AccountId, Instant, Role, unbrand } from "@counted/kernel";
import type { Membership, MembershipDirectory } from "@counted/identity-ports";
import type { IdentityAuth } from "./auth";
import { MEMBER_MODEL } from "./placement";
import { roleFrom } from "./role";
import { instantOf, type MemberRow } from "./rows";

export const betterAuthMembershipDirectory = (identity: IdentityAuth): MembershipDirectory => {
  const adapter = async () => (await identity.auth.$context).adapter;

  return {
    async roleOf(account, workspace): Promise<Role | null> {
      const row = await (
        await adapter()
      ).findOne<MemberRow>({
        model: MEMBER_MODEL,
        where: [
          { field: "userId", value: unbrand(account) },
          { field: "organizationId", value: unbrand(workspace) },
        ],
      });
      // An unknown workspace and an unknown account both answer null rather
      // than throwing: the caller asking "may this person do this here" gets
      // one answer shape for every way the answer can be no.
      return row === null ? null : roleFrom(row.role);
    },

    async membersOf(workspace): Promise<readonly Membership[]> {
      const rows = await (
        await adapter()
      ).findMany<MemberRow>({
        model: MEMBER_MODEL,
        where: [{ field: "organizationId", value: unbrand(workspace) }],
      });

      /**
       * Keyed by account so the same person appears once even if the table has
       * two rows for them — which better-auth does not create, but a botched
       * import can. Where there are two, the strongest role and the earliest
       * start win: showing less authority than the permission check will grant
       * is how a member list starts contradicting the system it describes.
       */
      const byAccount = new Map<string, Membership>();
      for (const row of rows) {
        const role = roleFrom(row.role);
        // A role this system has no rule for is not a membership. Reading it
        // as `member` would hand out the member grant because somebody typed
        // a role name into the database.
        if (role === null) continue;
        const since = instantOf(row.createdAt) ?? Instant.EPOCH;
        const existing = byAccount.get(row.userId);
        if (existing === undefined) {
          byAccount.set(row.userId, { account: AccountId(row.userId), role, since });
          continue;
        }
        byAccount.set(row.userId, {
          account: existing.account,
          role: strongest(existing.role, role),
          since: Instant.min(existing.since, since),
        });
      }
      return [...byAccount.values()];
    },
  };
};

/** `Role` is a type and a value in the kernel; this is the value half. */
const strongest = (a: Role, b: Role): Role => (Role.rank(a) >= Role.rank(b) ? a : b);
