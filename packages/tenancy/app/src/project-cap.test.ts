import { describe, expect, test } from "bun:test";
import { AccountId, Instant, ProjectId, WorkspaceId, isErr, isOk } from "@counted/kernel";
import { Workspace } from "@counted/tenancy-domain";
import {
  dropProjectSlot,
  releaseProjectSlot,
  reserveProjectSlot,
  restoreProjectSlot,
} from "./project-cap";
import { fakeWorkspaces } from "./testing";

const at = Instant.fromEpochMillis(1_700_000_000_000);
const ws = WorkspaceId("ws_1");
const founder = AccountId("acct_1");

const opened = (): Workspace => {
  const result = Workspace.open(ws, "Acme", founder, at);
  if (!isOk(result)) throw new Error("open should succeed");
  return result.value.workspace;
};

const fill = async (workspaces: ReturnType<typeof fakeWorkspaces>, n: number): Promise<void> => {
  for (let i = 0; i < n; i++) {
    const reserved = await reserveProjectSlot(
      { workspaces },
      { workspace: ws, project: ProjectId(`p${i}`), name: `Project ${i}` },
      at,
    );
    if (!isOk(reserved)) throw new Error(`reservation ${i} should succeed`);
  }
};

describe("reserving a slot", () => {
  test("the workspace it saved is the one it returns", async () => {
    const workspaces = fakeWorkspaces(opened());
    const reserved = await reserveProjectSlot(
      { workspaces },
      { workspace: ws, project: ProjectId("p1"), name: "Web" },
      at,
    );

    if (!isOk(reserved)) throw new Error("reservation should succeed");
    expect(reserved.value.projectCount).toBe(1);
    expect((await workspaces.find(ws))?.projectCount).toBe(1);
  });

  test("an unknown workspace is refused rather than throwing", async () => {
    const refused = await reserveProjectSlot(
      { workspaces: fakeWorkspaces() },
      { workspace: ws, project: ProjectId("p1"), name: "Web" },
      at,
    );
    if (!isErr(refused)) throw new Error("an unknown workspace should be refused");
    expect(refused.error).toEqual({ kind: "NoSuchWorkspace", workspace: ws });
  });

  test("the fourth project on the free plan is refused, and nothing is written", async () => {
    const workspaces = fakeWorkspaces(opened());
    await fill(workspaces, 3);
    const before = workspaces.saves;

    const refused = await reserveProjectSlot(
      { workspaces },
      { workspace: ws, project: ProjectId("p4"), name: "Fourth" },
      at,
    );

    if (!isErr(refused)) throw new Error("the fourth project should be refused");
    expect(refused.error).toEqual({ kind: "ProjectLimitReached", limit: 3 });
    expect(workspaces.saves).toBe(before);
  });
});

describe("the four slot commands share one count", () => {
  test("archive frees a slot, restore takes it back, delete releases it for good", async () => {
    const workspaces = fakeWorkspaces(opened());
    await fill(workspaces, 3);

    const archived = await releaseProjectSlot({ workspaces }, { workspace: ws, project: ProjectId("p0") }, at);
    if (!isOk(archived)) throw new Error("archiving should succeed");
    expect(archived.value.projectCount).toBe(2);
    // The archived project is still there — archiving is not deleting.
    expect(archived.value.projects).toHaveLength(3);

    const restored = await restoreProjectSlot({ workspaces }, { workspace: ws, project: ProjectId("p0") }, at);
    if (!isOk(restored)) throw new Error("restoring should succeed");
    expect(restored.value.projectCount).toBe(3);

    const dropped = await dropProjectSlot({ workspaces }, { workspace: ws, project: ProjectId("p0") }, at);
    if (!isOk(dropped)) throw new Error("dropping should succeed");
    expect(dropped.value.projectCount).toBe(2);
    expect(dropped.value.projects).toHaveLength(2);
  });

  test("every command emits exactly one event, so the outbox mirrors the register", async () => {
    const workspaces = fakeWorkspaces(opened());
    await fill(workspaces, 1);
    await releaseProjectSlot({ workspaces }, { workspace: ws, project: ProjectId("p0") }, at);
    await restoreProjectSlot({ workspaces }, { workspace: ws, project: ProjectId("p0") }, at);
    await dropProjectSlot({ workspaces }, { workspace: ws, project: ProjectId("p0") }, at);

    expect(workspaces.events.map((e) => e.kind)).toEqual([
      "ProjectProvisioned",
      "ProjectArchived",
      "ProjectRestored",
      "ProjectDeregistered",
    ]);
  });
});
