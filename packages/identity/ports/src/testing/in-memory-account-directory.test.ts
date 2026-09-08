import { describe, expect, test } from "bun:test";
import { AccountId, Instant } from "@counted/kernel";
import { accountDirectoryContract } from "../contract";
import { countingIdGenerator } from "./ids";
import { inMemoryAccountDirectory } from "./in-memory-account-directory";

accountDirectoryContract("in-memory", () => {
  const directory = inMemoryAccountDirectory();
  const ids = countingIdGenerator("acct");
  return {
    directory,
    async givenAccount(spec) {
      const account = {
        id: AccountId(ids.next()),
        email: spec.email,
        name: spec.name,
        emailVerified: spec.emailVerified,
        createdAt: Instant.fromEpochMillis(1_767_225_600_000),
      };
      directory.put(account);
      return account;
    },
    unknownAccount: () => AccountId("acct_nobody"),
  };
});

describe("inMemoryAccountDirectory", () => {
  test("put re-indexes the email, so changing one does not strand the old key", () => {
    const at = Instant.fromEpochMillis(0);
    const id = AccountId("a");
    const directory = inMemoryAccountDirectory([
      { id, email: "old@example.com", name: null, emailVerified: false, createdAt: at },
    ]);
    directory.put({ id, email: "new@example.com", name: null, emailVerified: true, createdAt: at });

    return Promise.all([
      directory.findByEmail("old@example.com").then((a) => expect(a).toBeNull()),
      directory.findByEmail("new@example.com").then((a) => expect(a?.id).toBe(id)),
    ]);
  });
});
