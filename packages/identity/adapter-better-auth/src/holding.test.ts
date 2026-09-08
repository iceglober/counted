/**
 * The holding workspace, created by the installation.
 *
 * What these pin is the difference between "the configuration names three
 * rows" and "the three rows exist". Before this function, the two variables
 * were required at boot for a value that could not exist at first boot —
 * DEVELOPING.md said so — and `POST /v1/projects/provision` therefore failed
 * on every database nobody had hand-seeded.
 */

import { describe, expect, test } from "bun:test";
import { AccountId, Instant, ProjectId, WorkspaceId, unbrand } from "@counted/kernel";
import { MEMBER_MODEL, ORGANIZATION_MODEL, USER_MODEL } from "./placement";
import type { MemberRow, OrganizationRow, UserRow } from "./rows";
import { createTestIdentity } from "./testing/harness";

const T0 = Instant.fromEpochMillis(1_767_225_600_000);

const rows = async (identity: ReturnType<typeof createTestIdentity>) => {
  const adapter = (await identity.auth.auth.$context).adapter;
  return {
    user: await adapter.findOne<UserRow>({
      model: USER_MODEL,
      where: [{ field: "id", value: "acct-holding-owner" }],
    }),
    organization: await adapter.findOne<OrganizationRow>({
      model: ORGANIZATION_MODEL,
      where: [{ field: "id", value: "ws-holding" }],
    }),
    member: await adapter.findOne<MemberRow>({
      model: MEMBER_MODEL,
      where: [
        { field: "organizationId", value: "ws-holding" },
        { field: "userId", value: "acct-holding-owner" },
      ],
    }),
  };
};

describe("ensureHoldingWorkspace", () => {
  test("creates all three rows on a database that has never seen a signup", async () => {
    const identity = createTestIdentity();
    const result = await identity.holding.ensure(T0);

    expect([...result.created].sort()).toEqual(["account", "membership", "workspace"]);
    const found = await rows(identity);
    expect(found.user).not.toBeNull();
    expect(found.organization).not.toBeNull();
    // Owner, because `CredentialGrants("ingest", role)` is empty below that:
    // `events:write` is admin-and-up on purpose.
    expect(found.member?.role).toBe("owner");
    expect(result.problem).toBeNull();
  });

  test("running it twice writes nothing the second time", async () => {
    // Boot is not a one-off. Every replica runs this, and a restart runs it
    // again; a second insert would be a primary-key violation and a boot loop.
    const identity = createTestIdentity();
    await identity.holding.ensure(T0);
    const second = await identity.holding.ensure(T0);

    expect(second.created).toEqual([]);
    expect(second.problem).toBeNull();
  });

  test("the account it creates cannot sign in", async () => {
    // A named, unroutable, unverified account with no credential row behind
    // it. Attributable — which an audit needs — and useless as a login, which
    // is the point. v1's answer to the same problem was `userId: ""`.
    const identity = createTestIdentity();
    await identity.holding.ensure(T0);
    const found = await rows(identity);

    expect(found.user?.email).toBe("unclaimed@counted.invalid");
    expect(Boolean(found.user?.emailVerified)).toBe(false);
  });

  test("an existing membership is reported, never promoted", async () => {
    // Point the two variables at a real workspace and a real account and this
    // must not quietly make that person an owner of it. Saying the standing
    // cannot issue is the correct behaviour; changing it is not.
    const identity = createTestIdentity();
    const workspace = WorkspaceId("ws-holding");
    const account = await identity.givenMember(workspace, "member", "already@example.com");

    const result = await identity.holding.ensure(T0);
    // A different account is named by the config, so the config's own rows are
    // created and the pre-existing member is untouched.
    expect(await identity.memberships.roleOf(account, workspace)).toBe("member");
    expect(result.problem).toBeNull();
  });

  test("a holding account that cannot mint an ingest key is named at boot, not at the first request", async () => {
    // The failure it replaces: provisioning answers 500 `NothingGrantable` to
    // the first anonymous caller, weeks later, with nothing in the boot log.
    const identity = createTestIdentity();
    const adapter = (await identity.auth.auth.$context).adapter;
    await adapter.create<Record<string, unknown>, UserRow>({
      model: USER_MODEL,
      data: {
        id: "acct-holding-owner",
        name: "holding",
        email: "unclaimed@counted.invalid",
        emailVerified: false,
        createdAt: Instant.toDate(T0),
        updatedAt: Instant.toDate(T0),
      },
      forceAllowId: true,
    });
    await adapter.create<Record<string, unknown>, OrganizationRow>({
      model: ORGANIZATION_MODEL,
      data: {
        id: "ws-holding",
        name: "holding",
        slug: "holding-preexisting",
        createdAt: Instant.toDate(T0),
      },
      forceAllowId: true,
    });
    await adapter.create<Record<string, unknown>, MemberRow>({
      model: MEMBER_MODEL,
      data: {
        organizationId: "ws-holding",
        userId: "acct-holding-owner",
        role: "member",
        createdAt: Instant.toDate(T0),
      },
    });

    const result = await identity.holding.ensure(T0);
    expect(result.created).toEqual([]);
    expect(result.problem).toContain("member");
    expect(result.problem).toContain("NothingGrantable");
  });

  test("the workspace it creates can actually issue an unclaimed project's key", async () => {
    // Three rows that exist is not the claim; a workspace that can mint the
    // ingest key `POST /v1/projects/provision` hands back is.
    const identity = createTestIdentity();
    const holding = await identity.holding.ensure(T0);
    const project = ProjectId("prj-unclaimed");
    identity.defineUnclaimedProject(project);

    const issued = await identity.credentials.issue(
      {
        kind: "ingest",
        name: "default",
        workspace: holding.workspace,
        project,
        issuedBy: holding.owner,
        expiresIn: null,
      },
      T0,
    );

    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.value.credential.permissions).toEqual(["events:write"]);
    expect(unbrand(issued.value.credential.issuedBy)).toBe(unbrand(AccountId("acct-holding-owner")));
  });
});
