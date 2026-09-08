/**
 * What any MembershipDirectory must do.
 *
 * The suite is short because the port is: two reads, one of which must never
 * disagree with the other. That last property is the one worth a test — a
 * member list that shows somebody the permission check then refuses is a
 * support ticket, and it comes from exactly this kind of two-path read.
 */

import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { ROLES, type AccountId, type Role, type WorkspaceId } from "@counted/kernel";
import type { MembershipDirectory } from "../membership-directory";

export type MembershipDirectoryHarness = {
  readonly directory: MembershipDirectory;
  /** A workspace that exists and starts with no members. */
  givenWorkspace(): Promise<WorkspaceId>;
  /** An account holding `role` in `workspace`. */
  givenMember(workspace: WorkspaceId, role: Role): Promise<AccountId>;
  unknownAccount(): AccountId;
  unknownWorkspace(): WorkspaceId;
  teardown?(): Promise<void>;
};

export const membershipDirectoryContract = (
  label: string,
  create: () => Promise<MembershipDirectoryHarness> | MembershipDirectoryHarness,
): void => {
  describe(`MembershipDirectory contract: ${label}`, () => {
    let h!: MembershipDirectoryHarness;

    beforeEach(async () => {
      h = await create();
    });
    afterEach(async () => {
      await h.teardown?.();
    });

    for (const role of ROLES) {
      test(`roleOf reports a ${role}`, async () => {
        const workspace = await h.givenWorkspace();
        const account = await h.givenMember(workspace, role);
        expect(await h.directory.roleOf(account, workspace)).toBe(role);
      });
    }

    test("roleOf is null for a non-member", async () => {
      // Null is "not a member" — the same authority as a member with no
      // permissions, but a different fact, and the audit line wants the fact.
      const workspace = await h.givenWorkspace();
      expect(await h.directory.roleOf(h.unknownAccount(), workspace)).toBeNull();
    });

    test("membership does not leak across workspaces", async () => {
      const mine = await h.givenWorkspace();
      const theirs = await h.givenWorkspace();
      const account = await h.givenMember(mine, "owner");

      expect(await h.directory.roleOf(account, theirs)).toBeNull();
      expect(await h.directory.membersOf(theirs)).toEqual([]);
    });

    test("an unknown workspace answers null and empty, never an error", async () => {
      const workspace = h.unknownWorkspace();
      expect(await h.directory.roleOf(h.unknownAccount(), workspace)).toBeNull();
      expect(await h.directory.membersOf(workspace)).toEqual([]);
    });

    test("membersOf lists everyone exactly once", async () => {
      const workspace = await h.givenWorkspace();
      const owner = await h.givenMember(workspace, "owner");
      const admin = await h.givenMember(workspace, "admin");
      const member = await h.givenMember(workspace, "member");

      const members = await h.directory.membersOf(workspace);
      expect(members.length).toBe(3);
      expect([...new Set(members.map((m) => m.account))].length).toBe(3);
      expect(members.map((m) => m.account).sort()).toEqual([owner, admin, member].sort());
    });

    test("membersOf and roleOf never disagree", async () => {
      const workspace = await h.givenWorkspace();
      await h.givenMember(workspace, "owner");
      await h.givenMember(workspace, "member");

      for (const membership of await h.directory.membersOf(workspace)) {
        expect(await h.directory.roleOf(membership.account, workspace)).toBe(membership.role);
      }
    });

    test("every membership carries the instant it began", async () => {
      const workspace = await h.givenWorkspace();
      await h.givenMember(workspace, "admin");
      const members = await h.directory.membersOf(workspace);
      const first = members[0];
      expect(first).toBeDefined();
      expect(typeof first?.since).toBe("number");
    });
  });
};
