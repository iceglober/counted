/**
 * `MembershipWriter` over the organization plugin's `member` table.
 *
 * Both writes run inside `adapter.transaction`, the same primitive
 * `provisioning.ts` uses and for the same reason it does not call the
 * vendor's endpoint: `/organization/update-member-role` and
 * `/organization/remove-member` require the acting user's session, which a
 * service key does not have, and they read and write outside any transaction.
 * The port's header (`@counted/identity-ports`, `membership-writer.ts`) says
 * the rest. What this file adds is how the rows are read.
 *
 * ### Rows, not memberships
 *
 * `membersOf` folds several rows for one account into one membership — the
 * strongest role, the earliest start — because a botched import can produce
 * them. A write has to make the same reading and then act on *every* row, or
 * a demoted owner keeps a second row that still says `owner` and `membersOf`
 * reports them promoted again. So the target's rows are all updated or all
 * deleted, and the owner count is a count of accounts, not of rows.
 *
 * PostgreSQL locks the organization row before checking the remaining owners.
 * Concurrent removals and role changes therefore cannot both remove the last
 * owner. The provider's overlapping mutation routes are blocked at the mount.
 */

import { AccountId, Instant, Role, err, ok, unbrand, type Result, type WorkspaceId } from "@counted/kernel";
import type {
  ChangeRoleFailure,
  Membership,
  MembershipWriter,
  RemoveMemberFailure,
} from "@counted/identity-ports";
import type { IdentityAuth } from "./auth";
import { MEMBER_MODEL } from "./placement";
import { roleFrom, roleTo } from "./role";
import { instantOf, type MemberRow } from "./rows";

type MemberTransaction = {
  rows(): Promise<MemberRow[]>;
  role(id: string, role: string): Promise<void>;
  remove(account: AccountId): Promise<void>;
};

/** One account's rows in one organization, read the way `membersOf` reads them. */
type Standing = {
  readonly rows: readonly MemberRow[];
  readonly role: Role;
  readonly since: Instant;
};

const standingOf = (rows: readonly MemberRow[], account: AccountId): Standing | null => {
  const mine = rows.filter((row) => row.userId === unbrand(account));
  let role: Role | null = null;
  let since: Instant | null = null;
  for (const row of mine) {
    const found = roleFrom(row.role);
    // A role this system has no rule for is not a membership — the same
    // reading `membersOf` makes, so the two cannot disagree about who is here.
    if (found === null) continue;
    role = role === null || Role.rank(found) > Role.rank(role) ? found : role;
    const started = instantOf(row.createdAt) ?? Instant.EPOCH;
    since = since === null ? started : Instant.min(since, started);
  }
  return role === null || since === null ? null : { rows: mine, role, since };
};

/** Accounts — not rows — holding `owner`. */
const ownersAmong = (rows: readonly MemberRow[]): number =>
  new Set(rows.filter((row) => roleFrom(row.role) === "owner").map((row) => row.userId)).size;

export const betterAuthMembershipWriter = (identity: IdentityAuth): MembershipWriter => {
  const pending = new Map<string, Promise<void>>();
  const transact = async <R>(workspace: WorkspaceId, run: (trx: MemberTransaction) => Promise<R>): Promise<R> => {
    if (identity.database.kind === "postgres") {
      const connection = await identity.database.pool.connect();
      try {
        await connection.query("BEGIN");
        await connection.query('SELECT id FROM "organization" WHERE id = $1 FOR UPDATE', [unbrand(workspace)]);
        const result = await run({
          rows: async () => (await connection.query<MemberRow>('SELECT * FROM "member" WHERE "organizationId" = $1', [unbrand(workspace)])).rows,
          role: async (id, role) => { await connection.query('UPDATE "member" SET role = $1 WHERE id = $2', [role, id]); },
          remove: async (account) => { await connection.query('DELETE FROM "member" WHERE "organizationId" = $1 AND "userId" = $2', [unbrand(workspace), unbrand(account)]); },
        });
        await connection.query("COMMIT");
        return result;
      } catch (error) { await connection.query("ROLLBACK"); throw error; }
      finally { connection.release(); }
    }
    // Mirror the serialization in the memory adapter used by contract tests.
    const previous = pending.get(workspace) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    pending.set(workspace, held);
    await previous;
    try {
      return await (await identity.auth.$context).adapter.transaction(async (trx) => run({
        rows: () => trx.findMany<MemberRow>({ model: MEMBER_MODEL, where: [{ field: "organizationId", value: unbrand(workspace) }] }),
        role: async (id, role) => { await trx.update({ model: MEMBER_MODEL, where: [{ field: "id", value: id }], update: { role } }); },
        remove: async (account) => { await trx.deleteMany({ model: MEMBER_MODEL, where: [{ field: "organizationId", value: unbrand(workspace) }, { field: "userId", value: unbrand(account) }] }); },
      }));
    } finally { release(); if (pending.get(workspace) === held) pending.delete(workspace); }
  };

  return {
    changeRole(workspace, account, role): Promise<Result<Membership, ChangeRoleFailure>> {
      return transact(workspace, async (trx) => {
        const rows = await trx.rows();
        const standing = standingOf(rows, account);
        if (standing === null) return err<ChangeRoleFailure>({ kind: "NotAMember", account });
        if (standing.role === role) {
          return err<ChangeRoleFailure>({ kind: "RoleUnchanged", account, role });
        }
        if (standing.role === "owner" && ownersAmong(rows) <= 1) {
          return err<ChangeRoleFailure>({ kind: "LastOwner", account });
        }
        for (const row of standing.rows) {
          await trx.role(row.id, roleTo(role));
        }
        // `since` is the row's `createdAt`, and it was not touched.
        return ok<Membership>({ account, role, since: standing.since });
      });
    },

    remove(workspace, account): Promise<Result<Membership, RemoveMemberFailure>> {
      return transact(workspace, async (trx) => {
        const rows = await trx.rows();
        const standing = standingOf(rows, account);
        if (standing === null) return err<RemoveMemberFailure>({ kind: "NotAMember", account });
        if (standing.role === "owner" && ownersAmong(rows) <= 1) {
          return err<RemoveMemberFailure>({ kind: "LastOwner", account });
        }
        await trx.remove(account);
        return ok<Membership>({ account, role: standing.role, since: standing.since });
      });
    },
  };
};
