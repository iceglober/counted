import { describe, expect, test } from "bun:test";
import { Instant, ProjectId, WorkspaceId, AccountId, isOk, isErr } from "@counted/kernel";
import { activeProjects, countAgainstCap, countsAgainstCap, type ProjectEntry } from "./project-count";
import { Workspace } from "./workspace";
import { workspaceUsage } from "./usage";

const at = Instant.fromEpochMillis(1_700_000_000_000);
const ws = WorkspaceId("ws_1");
const founder = AccountId("acct_1");

const entry = (id: string, state: "active" | "archived"): ProjectEntry => ({
  id: ProjectId(id),
  name: id,
  state,
});

describe("a project consumes a slot exactly while it is active", () => {
  test("archived projects cost nothing", () => {
    const entries = [entry("a", "active"), entry("b", "archived"), entry("c", "active")];
    expect(countAgainstCap(entries)).toBe(2);
    expect(activeProjects(entries).map((p) => p.id)).toEqual([ProjectId("a"), ProjectId("c")]);
    expect(countsAgainstCap(entry("b", "archived"))).toBe(false);
  });

  test("an empty register consumes nothing", () => {
    expect(countAgainstCap([])).toBe(0);
  });
});

/**
 * The v2 defect: the cap check counted active projects while the SQL that
 * loaded the workspace counted every row, so a workspace could be at 3/3 for
 * the create button and 5/3 for the usage bar at the same instant. One rule now
 * — this test is what says the three questions agree.
 */
describe("every question about how many projects there are gets the same answer", () => {
  const full = Workspace.rehydrate({
    id: ws,
    name: "Acme",
    plan: "free",
    payment: "active",
    projects: [
      entry("a", "active"),
      entry("b", "active"),
      entry("c", "active"),
      entry("d", "archived"),
      entry("e", "archived"),
    ],
  });

  test("the cap check, the usage readout and the aggregate agree", () => {
    // Five rows exist; three consume slots; the free cap is three.
    expect(full.projects).toHaveLength(5);
    expect(full.projectCount).toBe(3);

    const usage = workspaceUsage(full, { events: 0, seats: 1 });
    expect(usage.projects).toEqual({ used: 3, limit: 3 });

    const refused = full.registerProject(ProjectId("f"), "Sixth", at);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.error).toEqual({ kind: "ProjectLimitReached", limit: 3 });
  });

  test("archiving one frees exactly one slot, everywhere at once", () => {
    const archived = full.archiveProject(ProjectId("a"), at);
    expect(isOk(archived)).toBe(true);
    if (!isOk(archived)) return;

    const after = archived.value.workspace;
    expect(after.projectCount).toBe(2);
    expect(workspaceUsage(after, { events: 0, seats: 1 }).projects.used).toBe(2);
    expect(isOk(after.registerProject(ProjectId("f"), "Sixth", at))).toBe(true);
  });

  test("restoring is a cap decision, so archive-then-restore cannot exceed the cap", () => {
    const archived = full.archiveProject(ProjectId("a"), at);
    if (!isOk(archived)) throw new Error("archive should succeed");

    const filled = archived.value.workspace.registerProject(ProjectId("f"), "Sixth", at);
    if (!isOk(filled)) throw new Error("the freed slot should be available");

    const restored = filled.value.workspace.restoreProject(ProjectId("a"), at);
    expect(isErr(restored)).toBe(true);
    if (isErr(restored)) expect(restored.error).toEqual({ kind: "ProjectLimitReached", limit: 3 });
  });

  test("deleting a project releases its slot instead of holding it forever", () => {
    const dropped = full.deregisterProject(ProjectId("a"), at);
    if (!isOk(dropped)) throw new Error("deregister should succeed");
    expect(dropped.value.workspace.projects).toHaveLength(4);
    expect(dropped.value.workspace.projectCount).toBe(2);
    expect(isOk(dropped.value.workspace.registerProject(ProjectId("f"), "Sixth", at))).toBe(true);
  });
});

describe("a fresh workspace", () => {
  test("starts empty and on the free cap", () => {
    const opened = Workspace.open(ws, "Acme", founder, at);
    if (!isOk(opened)) throw new Error("open should succeed");
    expect(opened.value.workspace.projectCount).toBe(0);
    expect(opened.value.workspace.limits.maxProjects).toBe(3);
  });
});
