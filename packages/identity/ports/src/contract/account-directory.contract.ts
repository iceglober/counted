/**
 * What any AccountDirectory must do.
 *
 * Run this against the better-auth adapter and against the in-memory fake. A
 * port that only the fake satisfies is not an abstraction; it is a second
 * implementation nobody compared.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import type { AccountId } from "@counted/kernel";
import type { Account, AccountDirectory } from "../account-directory";

export type AccountSpec = {
  readonly email: string;
  readonly name: string | null;
  readonly emailVerified: boolean;
};

export type AccountDirectoryHarness = {
  readonly directory: AccountDirectory;
  /** Put an account in the directory. The implementation mints the id — the
   *  domain never does, so neither does this suite. */
  givenAccount(spec: AccountSpec): Promise<Account>;
  /** An id no account has, and that the suite will not create. */
  unknownAccount(): AccountId;
  teardown?(): Promise<void>;
};

export const accountDirectoryContract = (
  label: string,
  create: () => Promise<AccountDirectoryHarness> | AccountDirectoryHarness,
): void => {
  describe(`AccountDirectory contract: ${label}`, () => {
    let h!: AccountDirectoryHarness;

    beforeEach(async () => {
      h = await create();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    test("find returns the account", async () => {
      const created = await h.givenAccount({
        email: "ada@example.com",
        name: "Ada",
        emailVerified: true,
      });
      const found = await h.directory.find(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.email).toBe("ada@example.com");
      expect(found?.name).toBe("Ada");
      expect(found?.emailVerified).toBe(true);
    });

    test("find answers null for an unknown id rather than throwing", async () => {
      // A membership row can outlive the account it points at. The member list
      // has to render anyway.
      expect(await h.directory.find(h.unknownAccount())).toBeNull();
    });

    test("an account without a name has null, not an empty string", async () => {
      const created = await h.givenAccount({
        email: "anon@example.com",
        name: null,
        emailVerified: false,
      });
      expect((await h.directory.find(created.id))?.name).toBeNull();
    });

    test("findByEmail ignores case, because that is how it was typed", async () => {
      const created = await h.givenAccount({
        email: "Grace@Example.COM",
        name: "Grace",
        emailVerified: true,
      });
      expect((await h.directory.findByEmail("grace@example.com"))?.id).toBe(created.id);
      expect((await h.directory.findByEmail("GRACE@EXAMPLE.COM"))?.id).toBe(created.id);
    });

    test("findByEmail answers null for an address nobody has", async () => {
      // The invitation flow asks this routinely; "no" is not an error.
      expect(await h.directory.findByEmail("nobody@example.com")).toBeNull();
    });

    test("findByEmail and find agree", async () => {
      const created = await h.givenAccount({
        email: "same@example.com",
        name: "Same",
        emailVerified: true,
      });
      const byEmail = await h.directory.findByEmail("same@example.com");
      expect(byEmail).toEqual(await h.directory.find(created.id));
    });

    test("findMany returns exactly the ids it was asked for", async () => {
      const a = await h.givenAccount({ email: "a@example.com", name: null, emailVerified: true });
      const b = await h.givenAccount({ email: "b@example.com", name: null, emailVerified: true });
      await h.givenAccount({ email: "c@example.com", name: null, emailVerified: true });

      const found = await h.directory.findMany([a.id, b.id]);
      expect([...found.keys()].sort()).toEqual([a.id, b.id].sort());
      expect(found.get(a.id)?.email).toBe("a@example.com");
    });

    test("findMany omits unknown ids instead of mapping them to null", async () => {
      // The hole has to be impossible to forget: a caller iterating the map
      // never sees a null it has to remember to check.
      const a = await h.givenAccount({ email: "a@example.com", name: null, emailVerified: true });
      const missing = h.unknownAccount();

      const found = await h.directory.findMany([a.id, missing]);
      expect(found.has(missing)).toBe(false);
      expect(found.size).toBe(1);
    });

    test("findMany collapses duplicate ids", async () => {
      const a = await h.givenAccount({ email: "a@example.com", name: null, emailVerified: true });
      const found = await h.directory.findMany([a.id, a.id, a.id]);
      expect(found.size).toBe(1);
    });

    test("findMany of nothing is an empty map, not a round trip", async () => {
      const found = await h.directory.findMany([]);
      expect(found.size).toBe(0);
    });
  });
};
