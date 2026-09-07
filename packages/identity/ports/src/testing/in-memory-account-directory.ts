/**
 * An AccountDirectory backed by a Map.
 *
 * Exists so that a use-case test can say "this account is here" without a
 * database, a better-auth instance, or a migration. It passes
 * `accountDirectoryContract`, which is the only reason to trust it stands in
 * for the real one.
 */

import type { AccountId } from "@counted/kernel";
import type { Account, AccountDirectory } from "../account-directory";

export type InMemoryAccountDirectory = AccountDirectory & {
  /** Insert or replace. Re-indexes the email, so changing one is safe. */
  put(account: Account): void;
  remove(id: AccountId): void;
  clear(): void;
  readonly size: number;
};

/** better-auth compares addresses case-insensitively; so does this. */
const key = (email: string): string => email.toLowerCase();

export const inMemoryAccountDirectory = (
  seed: readonly Account[] = [],
): InMemoryAccountDirectory => {
  const byId = new Map<AccountId, Account>();

  const directory: InMemoryAccountDirectory = {
    put(account) {
      byId.set(account.id, account);
    },
    remove(id) {
      byId.delete(id);
    },
    clear() {
      byId.clear();
    },
    get size() {
      return byId.size;
    },
    async find(id) {
      return byId.get(id) ?? null;
    },
    async findByEmail(email) {
      const wanted = key(email);
      for (const account of byId.values()) {
        if (key(account.email) === wanted) return account;
      }
      return null;
    },
    async findMany(ids) {
      const found = new Map<AccountId, Account>();
      for (const id of ids) {
        const account = byId.get(id);
        // Absent rather than null: a caller iterating the map cannot then
        // forget to handle the hole.
        if (account !== undefined) found.set(id, account);
      }
      return found;
    },
  };

  for (const account of seed) directory.put(account);
  return directory;
};
