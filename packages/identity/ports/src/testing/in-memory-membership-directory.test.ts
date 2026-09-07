import { describe, expect, test } from "bun:test";
import { AccountId, Duration, Instant, WorkspaceId } from "@counted/kernel";
import { membershipDirectoryContract, membershipWriterContract } from "../contract";
import { countingIdGenerator } from "./ids";
import { inMemoryMembershipDirectory } from "./in-memory-membership-directory";

const T0 = Instant.fromEpochMillis(1_767_225_600_000);

const harness = () => {
  const directory = inMemoryMembershipDirectory();
  const accounts = countingIdGenerator("acct");
  const workspaces = countingIdGenerator("ws");
  return {
    directory,
    writer: directory,
    async givenWorkspace() {
      return WorkspaceId(workspaces.next());
    },
    async givenMember(workspace: WorkspaceId, role: import("@counted/kernel").Role) {
      const account = AccountId(accounts.next());
      directory.join(workspace, account, role, T0);
      return account;
    },
    unknownAccount: () => AccountId("acct_nobody"),
    unknownWorkspace: () => WorkspaceId("ws_nowhere"),
  };
};

membershipDirectoryContract("in-memory", harness);
membershipWriterContract("in-memory", harness);

describe("inMemoryMembershipDirectory", () => {
  test("a re-role keeps the original since, as better-auth does", async () => {
    const directory = inMemoryMembershipDirectory();
    const workspace = WorkspaceId("ws");
    const account = AccountId("acct");

    directory.join(workspace, account, "member", T0);
    directory.join(workspace, account, "owner", Instant.plus(T0, Duration.days(30)));

    const [membership] = await directory.membersOf(workspace);
    expect(membership?.role).toBe("owner");
    // "How long have they been here" survives a promotion.
    expect(membership?.since).toBe(T0);
  });

  test("leaving removes the role, not just the listing", async () => {
    const directory = inMemoryMembershipDirectory();
    const workspace = WorkspaceId("ws");
    const account = AccountId("acct");

    directory.join(workspace, account, "admin", T0);
    directory.leave(workspace, account);

    expect(await directory.roleOf(account, workspace)).toBeNull();
    expect(await directory.membersOf(workspace)).toEqual([]);
  });
});
