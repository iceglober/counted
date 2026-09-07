import { describe, expect, test } from "bun:test";
import {
  AccountId,
  Duration,
  Instant,
  ProjectId,
  WorkspaceId,
  type Permission,
} from "@counted/kernel";
import { ClaimDigest, Project, retentionPolicy } from "@counted/projects-domain";
import {
  archiveProject,
  claimProject,
  deleteProject,
  renameProject,
  restoreProject,
  setProjectRetention,
} from "./lifecycle";
import { harness, type Harness } from "./fakes";
import { issueCredential } from "./credentials";
import { provisionProject } from "./provision";

const NOW = Instant.fromEpochMillis(1_700_000_000_000);
const WS = WorkspaceId("ws_1");
const ACTOR = AccountId("acc_1");
const ADMIN: readonly Permission[] = [
  "events:write",
  "projects:read",
  "projects:write",
  "credentials:read",
  "credentials:write",
  "queries:run",
  "workspace:read",
];

const provisioned = async (h: Harness = harness(NOW)) => {
  const result = await provisionProject(h.deps, {
    workspace: WS,
    name: "Acme web",
    issuedBy: ACTOR,
    held: ADMIN,
  });
  if (!result.ok) throw new Error("provisioning failed in a fixture");
  h.outbox.enqueued.length = 0;
  return { h, project: result.value.project.id };
};

describe("mutating a project", () => {
  test("a rename persists the aggregate and its event together", async () => {
    const { h, project } = await provisioned();
    const renamed = await renameProject(h.deps, { project, name: "Acme marketing" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.name).toBe("Acme marketing");
    expect(h.outbox.kinds()).toEqual(["projects.ProjectRenamed"]);
    expect((await h.projects.find(project))?.name).toBe("Acme marketing");
  });

  test("a refused rule commits the transaction and writes nothing", async () => {
    // V3-SPEC §5: a Result returned from `transact` is a successful transaction
    // reporting a refused rule. Throwing instead would make every refused
    // rename read as a database failure in the logs.
    const { h, project } = await provisioned();
    const refused = await renameProject(h.deps, { project, name: "Acme web" });
    expect(refused).toEqual({ ok: false, error: { kind: "NameUnchanged" } });
    expect(h.outbox.enqueued).toHaveLength(0);
  });

  test("every command answers NoSuchProject for an id that is not there", async () => {
    const h = harness(NOW);
    const missing = ProjectId("missing");
    const expected = { ok: false as const, error: { kind: "NoSuchProject" as const, project: missing } };
    expect(await renameProject(h.deps, { project: missing, name: "x" })).toEqual(expected);
    expect(await archiveProject(h.deps, { project: missing })).toEqual(expected);
    expect(await restoreProject(h.deps, { project: missing })).toEqual(expected);
    expect(await deleteProject(h.deps, { project: missing })).toEqual(expected);
  });

  test("archive and restore round-trip", async () => {
    const { h, project } = await provisioned();
    const archived = await archiveProject(h.deps, { project });
    expect(archived.ok && archived.value.archived).toBe(true);
    const restored = await restoreProject(h.deps, { project });
    expect(restored.ok && restored.value.archived).toBe(false);
    expect(h.outbox.kinds()).toEqual(["projects.ProjectArchived", "projects.ProjectRestored"]);
  });

  test("retention is set as a policy, not a raw number", async () => {
    const { h, project } = await provisioned();
    const pinned = retentionPolicy(30);
    if (!pinned.ok) throw new Error("unreachable");
    const set = await setProjectRetention(h.deps, { project, retention: pinned.value });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.value.retention).toEqual({ kind: "days", days: 30 });
  });
});

describe("claimProject", () => {
  test("adopts an unclaimed project into a workspace on a matching digest", async () => {
    const h = harness(NOW);
    const digest = "a".repeat(64);
    const provisionedUnclaimed = Project.provisionUnclaimed(
      ProjectId("prj_free"),
      "slate-harbor",
      { digest: ClaimDigest(digest), expiresAt: Instant.plus(NOW, Duration.hours(24)) },
      NOW,
    );
    if (!provisionedUnclaimed.ok) throw new Error("unreachable");
    await h.projects.save(provisionedUnclaimed.value.project, provisionedUnclaimed.value.events);

    const claimed = await claimProject(h.deps, {
      project: ProjectId("prj_free"),
      digest,
      into: WS,
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.value.ownership).toEqual({ state: "claimed", workspace: WS, claimedAt: NOW });
    expect(h.outbox.kinds()).toEqual(["projects.ProjectClaimed"]);
  });

  test("a wrong digest changes nothing", async () => {
    const h = harness(NOW);
    const provisionedUnclaimed = Project.provisionUnclaimed(
      ProjectId("prj_free"),
      "slate-harbor",
      { digest: ClaimDigest("a".repeat(64)), expiresAt: Instant.plus(NOW, Duration.hours(24)) },
      NOW,
    );
    if (!provisionedUnclaimed.ok) throw new Error("unreachable");
    await h.projects.save(provisionedUnclaimed.value.project, provisionedUnclaimed.value.events);

    const refused = await claimProject(h.deps, {
      project: ProjectId("prj_free"),
      digest: "b".repeat(64),
      into: WS,
    });
    expect(refused).toEqual({ ok: false, error: { kind: "GrantMismatch" } });
    expect((await h.projects.find(ProjectId("prj_free")))?.isClaimed).toBe(false);
  });
});

describe("deleteProject", () => {
  test("kills every live key before removing the project", async () => {
    // The order is the design. Revoke-then-delete leaves, on a partial failure,
    // a project nobody can write to — recoverable. Delete-then-revoke leaves
    // live keys pointing at a project that no longer exists, with no console
    // page to revoke them from.
    const { h, project } = await provisioned();
    await issueCredential(h.deps, {
      project,
      kind: "service",
      name: "ci",
      issuedBy: ACTOR,
      held: ADMIN,
      expiresIn: null,
    });

    const deleted = await deleteProject(h.deps, { project });
    expect(deleted.ok).toBe(true);
    expect(await h.projects.find(project)).toBeNull();

    const keys = await h.credentials.list({ level: "project", project });
    expect(keys.every((k) => k.revokedAt === NOW)).toBe(true);
    expect(h.outbox.kinds()).toContain("projects.ProjectDeleted");
  });

  test("is retryable — an already-revoked key does not fail the second attempt", async () => {
    const { h, project } = await provisioned();
    const keys = await h.credentials.list({ level: "project", project });
    for (const key of keys) await h.credentials.revoke(key.id, NOW);

    expect((await deleteProject(h.deps, { project })).ok).toBe(true);
  });

  test("the deletion event carries the workspace, so a consumer can scope its undo", async () => {
    const { h, project } = await provisioned();
    await deleteProject(h.deps, { project });
    const event = h.outbox.enqueued.at(-1)?.payload;
    expect(event).toMatchObject({ kind: "ProjectDeleted", project, workspace: WS });
  });
});
