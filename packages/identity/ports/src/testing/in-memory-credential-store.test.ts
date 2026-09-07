import { describe, expect, test } from "bun:test";
import {
  AccountId,
  CredentialId,
  Duration,
  Instant,
  ProjectId,
  ROLES,
  WorkspaceId,
  type Role,
} from "@counted/kernel";
import { credentialStoreContract, expectOk } from "../contract";
import { countingIdGenerator } from "./ids";
import { inMemoryCredentialStore } from "./in-memory-credential-store";
import { inMemoryMembershipDirectory } from "./in-memory-membership-directory";
import { specCredentialGrants, specRoleGrants } from "./role-grants";

const T0 = Instant.fromEpochMillis(1_767_225_600_000);

/** The world every suite below runs in. Rebuilt per test by the contract runner. */
const stand = () => {
  const memberships = inMemoryMembershipDirectory();
  const holdingWorkspace = WorkspaceId("ws_holding");
  const store = inMemoryCredentialStore({
    memberships,
    grants: specCredentialGrants,
    ids: countingIdGenerator("cred"),
    holding: holdingWorkspace,
  });

  const workspace = WorkspaceId("ws_main");
  const project = ProjectId("proj_main");
  const otherWorkspace = WorkspaceId("ws_other");
  const otherProject = ProjectId("proj_other");
  const unclaimedProject = ProjectId("proj_unclaimed");

  store.defineProject(project, workspace);
  store.defineProject(otherProject, otherWorkspace);
  store.defineWorkspace(holdingWorkspace);
  store.defineUnclaimedProject(unclaimedProject);

  const holdingOwner = AccountId("acct_holding_owner");
  memberships.join(holdingWorkspace, holdingOwner, "owner", T0);

  const accounts: Record<Role, AccountId> = {
    owner: AccountId("acct_owner"),
    admin: AccountId("acct_admin"),
    member: AccountId("acct_member"),
  };
  for (const role of ROLES) memberships.join(workspace, accounts[role], role, T0);
  const otherOwner = AccountId("acct_other_owner");
  memberships.join(otherWorkspace, otherOwner, "owner", T0);

  return {
    store,
    memberships,
    workspace,
    project,
    otherWorkspace,
    otherProject,
    accounts,
    otherOwner,
    unclaimedProject,
    holdingWorkspace,
    holdingOwner,
  };
};

credentialStoreContract("in-memory", () => {
  const w = stand();
  return {
    store: w.store,
    grants: specCredentialGrants,
    held: specRoleGrants,
    world: {
      workspace: w.workspace,
      project: w.project,
      accounts: w.accounts,
      stranger: AccountId("acct_stranger"),
      otherWorkspace: w.otherWorkspace,
      otherProject: w.otherProject,
      otherOwner: w.otherOwner,
      unclaimedProject: w.unclaimedProject,
      holdingWorkspace: w.holdingWorkspace,
      holdingOwner: w.holdingOwner,
    },
    unknownCredential: () => CredentialId("cred_nowhere"),
    unknownWorkspace: () => WorkspaceId("ws_nowhere"),
    unknownProject: () => ProjectId("proj_nowhere"),
  };
});

describe("inMemoryCredentialStore", () => {
  test("verification records lastUsedAt, so a dormant key is visible", async () => {
    // Advisory, and the port does not require it — but a fake that never sets
    // it makes "find unused keys" untestable for everyone downstream.
    const w = stand();
    const issued = expectOk(
      await w.store.issue(
        {
          kind: "service",
          name: "k",
          workspace: w.workspace,
          project: null,
          issuedBy: w.accounts.owner,
          expiresIn: null,
        },
        T0,
      ),
      "issue",
    );

    const used = Instant.plus(T0, Duration.hours(3));
    expectOk(await w.store.verify(issued.secret, used), "verify");

    const [summary] = await w.store.list({ level: "workspace", workspace: w.workspace });
    expect(summary?.lastUsedAt).toBe(used);
  });

  test("a rotated key gets a fresh copy of the original's lifetime, not the original's deadline", async () => {
    // Otherwise rotating a key on its last day hands you another key that dies
    // the same day, which is renewal theatre.
    const w = stand();
    const issued = expectOk(
      await w.store.issue(
        {
          kind: "service",
          name: "k",
          workspace: w.workspace,
          project: null,
          issuedBy: w.accounts.owner,
          expiresIn: Duration.days(90),
        },
        T0,
      ),
      "issue",
    );

    const rotatedAt = Instant.plus(T0, Duration.days(89));
    const rotated = expectOk(await w.store.rotate(issued.credential.id, Duration.hours(1), rotatedAt), "rotate");

    expect(rotated.issued.credential.expiresAt).toBe(Instant.plus(rotatedAt, Duration.days(90)));
  });

  test("a promotion does not widen keys already in circulation", async () => {
    // Permissions are a snapshot taken at issuance. Re-expanding the issuer's
    // current role on every request would silently upgrade every key in the
    // wild the moment somebody is made an owner.
    const w = stand();
    const issued = expectOk(
      await w.store.issue(
        {
          kind: "service",
          name: "k",
          workspace: w.workspace,
          project: null,
          issuedBy: w.accounts.member,
          expiresIn: null,
        },
        T0,
      ),
      "issue",
    );

    w.memberships.join(w.workspace, w.accounts.member, "owner", T0);

    const verified = expectOk(await w.store.verify(issued.secret, T0), "verify");
    expect(verified.permissions).not.toContain("billing:write");
    expect([...verified.permissions].sort()).toEqual(
      [...specCredentialGrants("service", "member")].sort(),
    );
  });
});
