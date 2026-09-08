/**
 * What any MembershipWriter must do.
 *
 * The suite is mostly about the refusals, because those are the rules: the
 * one write that must never succeed is the one that leaves a workspace with
 * no owner, and the one that must never be silent is the one that changes
 * nothing. Every successful write is checked through `MembershipDirectory`
 * rather than through the writer's own answer — a writer that reports a role
 * the directory then contradicts is the two-path disagreement the directory's
 * suite already guards against, from the other side.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import type { MembershipDirectory } from "../membership-directory";
import type { MembershipWriter } from "../membership-writer";
import type { MembershipDirectoryHarness } from "./membership-directory.contract";
import { expectErr, expectOk } from "./result";

export type MembershipWriterHarness = MembershipDirectoryHarness & {
  readonly directory: MembershipDirectory;
  readonly writer: MembershipWriter;
};

export const membershipWriterContract = (
  label: string,
  create: () => Promise<MembershipWriterHarness> | MembershipWriterHarness,
): void => {
  describe(`MembershipWriter contract: ${label}`, () => {
    let h!: MembershipWriterHarness;

    beforeEach(async () => {
      h = await create();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    test("a role change is visible through the directory, with the original since", async () => {
      const workspace = await h.givenWorkspace();
      await h.givenMember(workspace, "owner");
      const account = await h.givenMember(workspace, "member");
      const before = (await h.directory.membersOf(workspace)).find((m) => m.account === account);
      if (before === undefined) throw new Error("harness: the member it created is not listed");

      const changed = expectOk(await h.writer.changeRole(workspace, account, "admin"), "changeRole");
      expect(changed.account).toBe(account);
      expect(changed.role).toBe("admin");

      expect(await h.directory.roleOf(account, workspace)).toBe("admin");
      const after = (await h.directory.membersOf(workspace)).find((m) => m.account === account);
      expect(after?.role).toBe("admin");
      // "How long have they been here" survives a promotion.
      expect(after?.since).toBe(before.since);
      expect(changed.since).toBe(before.since);
    });

    test("setting the role somebody already holds is refused as unchanged", async () => {
      const workspace = await h.givenWorkspace();
      await h.givenMember(workspace, "owner");
      const account = await h.givenMember(workspace, "admin");

      const error = expectErr(await h.writer.changeRole(workspace, account, "admin"), "changeRole");
      expect(error).toEqual({ kind: "RoleUnchanged", account, role: "admin" });
    });

    test("a non-member cannot be given a role", async () => {
      const workspace = await h.givenWorkspace();
      await h.givenMember(workspace, "owner");
      const stranger = h.unknownAccount();

      const error = expectErr(await h.writer.changeRole(workspace, stranger, "member"), "changeRole");
      expect(error).toEqual({ kind: "NotAMember", account: stranger });
      // Refused, not inserted: the invitation flow is the only way in.
      expect(await h.directory.roleOf(stranger, workspace)).toBeNull();
    });

    test("an unknown workspace answers NotAMember, never an error", async () => {
      const account = h.unknownAccount();
      const workspace = h.unknownWorkspace();
      expect(expectErr(await h.writer.changeRole(workspace, account, "member"), "changeRole").kind).toBe(
        "NotAMember",
      );
      expect(expectErr(await h.writer.remove(workspace, account), "remove").kind).toBe("NotAMember");
    });

    test("the only owner cannot be demoted", async () => {
      const workspace = await h.givenWorkspace();
      const owner = await h.givenMember(workspace, "owner");
      await h.givenMember(workspace, "admin");

      const error = expectErr(await h.writer.changeRole(workspace, owner, "admin"), "changeRole");
      expect(error).toEqual({ kind: "LastOwner", account: owner });
      expect(await h.directory.roleOf(owner, workspace)).toBe("owner");
    });

    test("one of two owners can be demoted", async () => {
      const workspace = await h.givenWorkspace();
      const first = await h.givenMember(workspace, "owner");
      await h.givenMember(workspace, "owner");

      expectOk(await h.writer.changeRole(workspace, first, "member"), "changeRole");
      expect(await h.directory.roleOf(first, workspace)).toBe("member");
    });

    test("an owner can be promoted from below without an owner being lost", async () => {
      const workspace = await h.givenWorkspace();
      await h.givenMember(workspace, "owner");
      const admin = await h.givenMember(workspace, "admin");

      expectOk(await h.writer.changeRole(workspace, admin, "owner"), "changeRole");
      expect(await h.directory.roleOf(admin, workspace)).toBe("owner");
    });

    test("a removed member is gone from both reads", async () => {
      const workspace = await h.givenWorkspace();
      await h.givenMember(workspace, "owner");
      const account = await h.givenMember(workspace, "member");

      const removed = expectOk(await h.writer.remove(workspace, account), "remove");
      expect(removed.account).toBe(account);
      expect(removed.role).toBe("member");

      expect(await h.directory.roleOf(account, workspace)).toBeNull();
      expect((await h.directory.membersOf(workspace)).map((m) => m.account)).not.toContain(account);
    });

    test("the only owner cannot be removed", async () => {
      const workspace = await h.givenWorkspace();
      const owner = await h.givenMember(workspace, "owner");
      await h.givenMember(workspace, "member");

      const error = expectErr(await h.writer.remove(workspace, owner), "remove");
      expect(error).toEqual({ kind: "LastOwner", account: owner });
      expect(await h.directory.roleOf(owner, workspace)).toBe("owner");
    });

    test("one of two owners can be removed", async () => {
      const workspace = await h.givenWorkspace();
      const first = await h.givenMember(workspace, "owner");
      const second = await h.givenMember(workspace, "owner");

      expectOk(await h.writer.remove(workspace, first), "remove");
      expect(await h.directory.roleOf(first, workspace)).toBeNull();
      expect(await h.directory.roleOf(second, workspace)).toBe("owner");
    });

    test("removing a non-member is refused, and nothing else changes", async () => {
      const workspace = await h.givenWorkspace();
      const owner = await h.givenMember(workspace, "owner");

      const error = expectErr(await h.writer.remove(workspace, h.unknownAccount()), "remove");
      expect(error.kind).toBe("NotAMember");
      expect((await h.directory.membersOf(workspace)).map((m) => m.account)).toEqual([owner]);
    });

    test("writes do not leak across workspaces", async () => {
      const here = await h.givenWorkspace();
      const there = await h.givenWorkspace();
      const owner = await h.givenMember(here, "owner");
      const admin = await h.givenMember(here, "admin");
      const otherOwner = await h.givenMember(there, "owner");

      expectOk(await h.writer.changeRole(here, admin, "member"), "changeRole");
      expectOk(await h.writer.remove(here, admin), "remove");

      expect((await h.directory.membersOf(here)).map((m) => m.account)).toEqual([owner]);
      expect((await h.directory.membersOf(there)).map((m) => m.account)).toEqual([otherOwner]);
      expect(await h.directory.roleOf(otherOwner, there)).toBe("owner");
    });
  });
};
