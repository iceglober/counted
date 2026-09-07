/**
 * The two-write problem, tested by making the second write fail.
 *
 * An organization with no workspace is the failure worth engineering against:
 * people can sign in and belong to something no plan applies to, no limit
 * constrains and no invoice covers. The test that matters is therefore not
 * "provisioning works" but "when the domain half refuses, the organization is
 * not there either".
 */

import { describe, expect, test } from "bun:test";
import { Instant, WorkspaceId, type AccountId } from "@counted/kernel";
import { MEMBER_MODEL, ORGANIZATION_MODEL } from "./placement";
import { createTestIdentity, noopMirror } from "./testing/harness";

const AT = Instant.fromEpochMillis(1_767_225_600_000);

const rows = async (identity: ReturnType<typeof createTestIdentity>, model: string) =>
  (await identity.auth.auth.$context).adapter.findMany<Record<string, unknown>>({ model });

describe("provisioning a workspace", () => {
  test("creates the organization, the owner's membership and the domain row under one id", async () => {
    const identity = createTestIdentity();
    const owner = await identity.givenAccount({
      email: "owner@example.com",
      name: "Owner",
      emailVerified: true,
    });

    const placed: { workspace: WorkspaceId; owner: AccountId }[] = [];
    const result = await identity.workspaces.provision(
      { name: "Acme", slug: "acme", owner },
      {
        async place(workspace, placedOwner) {
          placed.push({ workspace, owner: placedOwner });
        },
      },
      AT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The organization and the workspace share an id and mean different
    // things: who belongs here, versus what plan and what limits.
    expect(placed).toEqual([{ workspace: result.value.workspace, owner }]);
    expect(result.value.createdAt).toBe(AT);

    expect(await identity.memberships.roleOf(owner, result.value.workspace)).toBe("owner");
    const members = await identity.memberships.membersOf(result.value.workspace);
    expect(members.map((m) => m.account)).toEqual([owner]);
    expect(members[0]?.since).toBe(AT);
  });

  test("a mirror that refuses leaves no organization behind", async () => {
    const identity = createTestIdentity();
    const owner = await identity.givenAccount({
      email: "owner@example.com",
      name: null,
      emailVerified: true,
    });

    const result = await identity.workspaces.provision(
      { name: "Acme", slug: "acme", owner },
      {
        async place() {
          throw new Error("plan catalogue unavailable");
        },
      },
      AT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NotProvisioned");

    // Both vendor rows rolled back. This is the assertion the whole ordering
    // argument in provisioning.ts exists to make true.
    expect(await rows(identity, ORGANIZATION_MODEL)).toEqual([]);
    expect(await rows(identity, MEMBER_MODEL)).toEqual([]);
  });

  test("the slug is unique, and the refusal costs nothing", async () => {
    const identity = createTestIdentity();
    const owner = await identity.givenAccount({
      email: "owner@example.com",
      name: null,
      emailVerified: true,
    });

    expect((await identity.workspaces.provision({ name: "A", slug: "acme", owner }, noopMirror, AT)).ok).toBe(true);

    let placed = 0;
    const second = await identity.workspaces.provision(
      { name: "B", slug: "acme", owner },
      {
        async place() {
          placed += 1;
        },
      },
      AT,
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toEqual({ kind: "SlugTaken", slug: "acme" });
    // The mirror is never asked to write a workspace for an organization that
    // was not created.
    expect(placed).toBe(0);
    expect((await rows(identity, ORGANIZATION_MODEL)).length).toBe(1);
  });

  test("an owner who does not exist is refused before anything is written", async () => {
    const identity = createTestIdentity();
    const result = await identity.workspaces.provision(
      { name: "Acme", slug: "acme", owner: "nobody" as AccountId },
      noopMirror,
      AT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NoSuchAccount");
    expect(await rows(identity, ORGANIZATION_MODEL)).toEqual([]);
  });
});
