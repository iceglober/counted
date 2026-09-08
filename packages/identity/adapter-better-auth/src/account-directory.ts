/**
 * `AccountDirectory` over better-auth's `user` table.
 *
 * Read-only, and that is not a limitation of this file — sign-up, sign-in,
 * password reset and social linking all happen through better-auth's own HTTP
 * surface. What the domain needs from an account is narrower: an address to
 * notify, a name to render, and a truthful "no such account" when a membership
 * row points at nothing.
 */

import { AccountId, Instant, unbrand } from "@counted/kernel";
import type { Account, AccountDirectory } from "@counted/identity-ports";
import type { IdentityAuth } from "./auth";
import { instantOf, booleanOf, type UserRow } from "./rows";
import { USER_MODEL } from "./placement";

const toAccount = (row: UserRow): Account => ({
  id: AccountId(row.id),
  email: row.email,
  /**
   * better-auth stores `""` for a user who never gave a name — an OAuth
   * profile with no display name, or a sign-up form with the field blank. The
   * port says null, because "" renders as a blank line in a member list and
   * null renders as the email address.
   */
  name: typeof row.name === "string" && row.name.length > 0 ? row.name : null,
  emailVerified: booleanOf(row.emailVerified, false),
  createdAt: instantOf(row.createdAt) ?? Instant.EPOCH,
});

export const betterAuthAccountDirectory = (identity: IdentityAuth): AccountDirectory => {
  const adapter = async () => (await identity.auth.$context).adapter;

  return {
    async find(id) {
      const row = await (
        await adapter()
      ).findOne<UserRow>({
        model: USER_MODEL,
        where: [{ field: "id", value: unbrand(id) }],
      });
      return row === null ? null : toAccount(row);
    },

    async findByEmail(email) {
      /**
       * Lowercased rather than matched case-insensitively, because that is
       * exactly what better-auth's own `createUser` and `findUserByEmail` do.
       * Agreeing with the write path is what makes "the account this returns
       * is the one sign-in resolves" true; a clever `ILIKE` here would answer
       * a different question than the login form does.
       */
      const row = await (
        await adapter()
      ).findOne<UserRow>({
        model: USER_MODEL,
        where: [{ field: "email", value: email.toLowerCase() }],
      });
      return row === null ? null : toAccount(row);
    },

    async findMany(ids) {
      // Not a round trip. An empty `in` clause is a query whose answer is
      // known, and some drivers turn `IN ()` into a syntax error.
      if (ids.length === 0) return new Map();

      const unique = [...new Set(ids.map((id) => unbrand(id)))];
      const rows = await (
        await adapter()
      ).findMany<UserRow>({
        model: USER_MODEL,
        where: [{ field: "id", operator: "in", value: unique }],
        limit: unique.length,
      });

      // Unknown ids are omitted rather than mapped to null, so a caller
      // iterating the map never meets a hole it has to remember to check.
      const found = new Map<AccountId, Account>();
      for (const row of rows) found.set(AccountId(row.id), toAccount(row));
      return found;
    },
  };
};
