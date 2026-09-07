/**
 * The three port contract suites, run against a real better-auth instance.
 *
 * These are not this adapter's tests — they are the port's, and the in-memory
 * fakes in `@counted/identity-ports/testing` run the same ones. That is the
 * whole claim to being replaceable: two implementations, one definition of
 * correct, and any disagreement between them shows up as a failure rather than
 * as a surprise in production.
 */

import {
  accountDirectoryContract,
  credentialStoreContract,
  membershipDirectoryContract,
  membershipWriterContract,
} from "@counted/identity-ports/contract";
import { AccountId, CredentialId, Instant, ProjectId, WorkspaceId, type Role } from "@counted/kernel";
import { specCredentialGrants, specRoleGrants } from "@counted/identity-ports/testing";
import { createTestIdentity } from "./testing/harness";

const T0 = Instant.fromEpochMillis(1_767_225_600_000);

accountDirectoryContract("better-auth", async () => {
  const identity = createTestIdentity();
  return {
    directory: identity.accounts,
    async givenAccount(spec) {
      const id = await identity.givenAccount(spec);
      const account = await identity.accounts.find(id);
      if (account === null) throw new Error("harness: created account did not read back");
      return account;
    },
    unknownAccount: () => AccountId("no-such-account"),
  };
});

membershipDirectoryContract("better-auth", async () => {
  const identity = createTestIdentity();
  return {
    directory: identity.memberships,
    givenWorkspace: () => identity.givenWorkspace(),
    givenMember: (workspace: WorkspaceId, role: Role) => identity.givenMember(workspace, role),
    unknownAccount: () => AccountId("no-such-account"),
    unknownWorkspace: () => WorkspaceId("no-such-workspace"),
  };
});

membershipWriterContract("better-auth", async () => {
  const identity = createTestIdentity();
  return {
    directory: identity.memberships,
    writer: identity.memberships,
    givenWorkspace: () => identity.givenWorkspace(),
    givenMember: (workspace: WorkspaceId, role: Role) => identity.givenMember(workspace, role),
    unknownAccount: () => AccountId("no-such-account"),
    unknownWorkspace: () => WorkspaceId("no-such-workspace"),
  };
});

credentialStoreContract("better-auth", async () => {
  const identity = createTestIdentity();

  const workspace = await identity.givenWorkspace("Acme");
  const otherWorkspace = await identity.givenWorkspace("Other");

  const project = ProjectId("project-acme");
  const otherProject = ProjectId("project-other");
  const unclaimedProject = ProjectId("project-unclaimed");
  identity.defineProject(project, workspace);
  identity.defineProject(otherProject, otherWorkspace);
  identity.defineUnclaimedProject(unclaimedProject);

  // The holding workspace's rows, created the way production creates them —
  // so the suite proves `ensureHoldingWorkspace` produces a workspace that can
  // actually issue, and not just three rows.
  const holding = await identity.holding.ensure(T0);

  const accounts = {
    owner: await identity.givenMember(workspace, "owner"),
    admin: await identity.givenMember(workspace, "admin"),
    member: await identity.givenMember(workspace, "member"),
  } as const;

  return {
    store: identity.credentials,
    grants: specCredentialGrants,
    held: specRoleGrants,
    world: {
      workspace,
      project,
      accounts,
      // A real account that belongs to no workspace: the difference between
      // "not a member" and "no such person" is what `IssuerNotAMember` means.
      stranger: await identity.givenAccount({
        email: `stranger-${Math.random().toString(36).slice(2)}@example.com`,
        name: null,
        emailVerified: true,
      }),
      otherWorkspace,
      otherProject,
      otherOwner: await identity.givenMember(otherWorkspace, "owner"),
      unclaimedProject,
      holdingWorkspace: holding.workspace,
      holdingOwner: holding.owner,
    },
    unknownCredential: () => CredentialId("no-such-credential"),
    unknownWorkspace: () => WorkspaceId("no-such-workspace"),
    unknownProject: () => ProjectId("no-such-project"),
  };
});
