import { describe, expect, test } from "bun:test";
import { AccountId, Instant, ProjectId, WorkspaceId, isErr, isOk } from "@counted/kernel";
import { Workspace, type WorkspaceSnapshot } from "./workspace";
import { tenancyEventType, type WorkspaceEvent } from "./events";
import type { ProjectEntry } from "./project-count";

const at = Instant.fromEpochMillis(1_700_000_000_000);
const later = Instant.fromEpochMillis(1_700_000_060_000);
const ws = WorkspaceId("ws_1");
const founder = AccountId("acct_founder");

const open = (): Workspace => {
  const opened = Workspace.open(ws, "Acme", founder, at);
  if (!isOk(opened)) throw new Error("open should succeed");
  return opened.value.workspace;
};

const snapshot = (patch: Partial<WorkspaceSnapshot>): Workspace =>
  Workspace.rehydrate({
    id: ws,
    name: "Acme",
    plan: "free",
    payment: "none",
    projects: [],
    ...patch,
  });

const kinds = (events: readonly WorkspaceEvent[]): readonly string[] => events.map((e) => e.kind);

describe("opening a workspace", () => {
  test("it is born on the free plan — a creation path cannot mint a paid entitlement", () => {
    const opened = Workspace.open(ws, "Acme", founder, at);
    if (!isOk(opened)) throw new Error("open should succeed");
    expect(opened.value.workspace.plan).toBe("free");
    expect(opened.value.workspace.payment).toBe("none");
    expect(opened.value.workspace.entitlement.inGrace).toBe(false);
    expect(kinds(opened.value.events)).toEqual(["WorkspaceOpened"]);
  });

  test("a blank name is refused", () => {
    const refused = Workspace.open(ws, "   ", founder, at);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.error.kind).toBe("NameRequired");
  });

  test("the founder is on the event and nowhere else — membership is better-auth's", () => {
    const opened = Workspace.open(ws, "Acme", founder, at);
    if (!isOk(opened)) throw new Error("open should succeed");
    const [event] = opened.value.events;
    expect(event).toEqual({ kind: "WorkspaceOpened", workspace: ws, founder, at });
    expect(Object.keys(opened.value.workspace.snapshot())).not.toContain("memberships");
  });
});

describe("limits are derived from the standing, never stored", () => {
  test("a rehydrated pro workspace enforces pro's cap without being told", () => {
    // v2's Postgres adapter loaded every workspace with UNLIMITED limits because
    // the entitlement was resolved elsewhere, so the cap was unenforceable after
    // a load. There is nothing to pass in now.
    const pro = snapshot({ plan: "pro", payment: "active" });
    expect(pro.limits.maxProjects).toBeNull();
    expect(pro.entitlement.limits.eventsPerMonth).toBe(1_000_000);
  });

  test("a canceled pro workspace enforces the free cap while remembering the plan", () => {
    const lapsed = snapshot({ plan: "pro", payment: "canceled" });
    expect(lapsed.plan).toBe("pro");
    expect(lapsed.entitlement.plan).toBe("free");
    expect(lapsed.limits.maxProjects).toBe(3);
  });
});

describe("renaming", () => {
  test("a no-op rename succeeds with no event", () => {
    const renamed = open().rename("Acme", later);
    if (!isOk(renamed)) throw new Error("rename should succeed");
    expect(renamed.value.events).toEqual([]);
  });

  test("whitespace is trimmed, and a blank name is refused", () => {
    const renamed = open().rename("  Acme Inc  ", later);
    if (!isOk(renamed)) throw new Error("rename should succeed");
    expect(renamed.value.workspace.name).toBe("Acme Inc");
    expect(isErr(open().rename("", later))).toBe(true);
  });
});

describe("registering a project", () => {
  test("the same id twice is refused", () => {
    const first = open().registerProject(ProjectId("p1"), "Web", at);
    if (!isOk(first)) throw new Error("first registration should succeed");
    const again = first.value.workspace.registerProject(ProjectId("p1"), "Web again", at);
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.error).toEqual({ kind: "ProjectExists", project: ProjectId("p1") });
  });

  test("a blank project name is refused before the cap is consulted", () => {
    const refused = open().registerProject(ProjectId("p1"), " ", at);
    if (!isErr(refused)) throw new Error("blank name should be refused");
    expect(refused.error.kind).toBe("NameRequired");
  });

  test("an unlimited plan never refuses", () => {
    let workspace = snapshot({ plan: "pro", payment: "active" });
    for (let i = 0; i < 25; i++) {
      const applied = workspace.registerProject(ProjectId(`p${i}`), `Project ${i}`, at);
      if (!isOk(applied)) throw new Error(`registration ${i} should succeed`);
      workspace = applied.value.workspace;
    }
    expect(workspace.projectCount).toBe(25);
  });
});

describe("archiving and restoring", () => {
  const withProjects = (...entries: readonly ProjectEntry[]): Workspace =>
    snapshot({ payment: "active", projects: entries });

  test("archiving twice is refused rather than being a silent no-op", () => {
    const workspace = withProjects({ id: ProjectId("p1"), name: "Web", state: "archived" });
    const refused = workspace.archiveProject(ProjectId("p1"), at);
    if (!isErr(refused)) throw new Error("double archive should be refused");
    expect(refused.error.kind).toBe("ProjectAlreadyArchived");
  });

  test("restoring an active project is refused", () => {
    const workspace = withProjects({ id: ProjectId("p1"), name: "Web", state: "active" });
    const refused = workspace.restoreProject(ProjectId("p1"), at);
    if (!isErr(refused)) throw new Error("restoring an active project should be refused");
    expect(refused.error.kind).toBe("ProjectNotArchived");
  });

  test("every project command refuses an id it does not hold", () => {
    const workspace = open();
    const missing = ProjectId("nope");
    for (const applied of [
      workspace.archiveProject(missing, at),
      workspace.restoreProject(missing, at),
      workspace.deregisterProject(missing, at),
    ]) {
      if (!isErr(applied)) throw new Error("an unknown project should be refused");
      expect(applied.error).toEqual({ kind: "NoSuchProject", project: missing });
    }
  });
});

describe("seats", () => {
  test("an uncapped plan seats anyone", () => {
    const allowed = open().mayAdmitSeat({ seats: 500 });
    if (!isOk(allowed)) throw new Error("no plan caps seats today");
    expect(allowed.value).toEqual({ used: 500, limit: null });
  });
});

describe("adopting what the payment provider says", () => {
  test("an unchanged standing emits nothing, so a redelivered webhook is a true no-op", () => {
    const workspace = snapshot({ plan: "pro", payment: "active" });
    const applied = workspace.applyStanding({ plan: "pro", payment: "active" }, { seats: 3 }, later);
    expect(applied.events).toEqual([]);
  });

  test("an upgrade reports the plan and the new limits", () => {
    const applied = open().applyStanding({ plan: "pro", payment: "active" }, { seats: 1 }, later);
    expect(kinds(applied.events)).toEqual(["PlanChanged", "PaymentStateChanged", "LimitsChanged"]);
    expect(applied.workspace.limits.maxProjects).toBeNull();
  });

  test("going past due keeps the limits, so only the payment state is news", () => {
    const workspace = snapshot({ plan: "pro", payment: "active" });
    const applied = workspace.applyStanding({ plan: "pro", payment: "past_due" }, { seats: 1 }, later);
    expect(kinds(applied.events)).toEqual(["PaymentStateChanged"]);
    expect(applied.workspace.entitlement.inGrace).toBe(true);
    expect(applied.workspace.limits.maxProjects).toBeNull();
  });

  test("a downgrade that leaves the workspace over its cap reports it and deletes nothing", () => {
    const workspace = snapshot({
      plan: "pro",
      payment: "active",
      projects: [
        { id: ProjectId("a"), name: "a", state: "active" },
        { id: ProjectId("b"), name: "b", state: "active" },
        { id: ProjectId("c"), name: "c", state: "active" },
        { id: ProjectId("d"), name: "d", state: "active" },
        { id: ProjectId("e"), name: "e", state: "archived" },
      ],
    });

    const applied = workspace.applyStanding({ plan: "pro", payment: "canceled" }, { seats: 2 }, later);
    expect(kinds(applied.events)).toEqual(["PaymentStateChanged", "LimitsChanged", "OverProjectLimit"]);
    expect(applied.workspace.projects).toHaveLength(5);

    const over = applied.events.find((e) => e.kind === "OverProjectLimit");
    // Four active, one archived: the over-limit report counts slots, not rows.
    expect(over).toEqual({ kind: "OverProjectLimit", workspace: ws, active: 4, limit: 3, at: later });
  });

  test("exactly at the cap is not over it", () => {
    const workspace = snapshot({
      plan: "pro",
      payment: "active",
      projects: [
        { id: ProjectId("a"), name: "a", state: "active" },
        { id: ProjectId("b"), name: "b", state: "active" },
        { id: ProjectId("c"), name: "c", state: "active" },
      ],
    });
    const applied = workspace.applyStanding({ plan: "free", payment: "none" }, { seats: 1 }, later);
    expect(kinds(applied.events)).not.toContain("OverProjectLimit");
    // …but there is no room for another.
    expect(isErr(applied.workspace.registerProject(ProjectId("d"), "d", later))).toBe(true);
  });
});

describe("event envelope type strings", () => {
  test("are '<context>.<Kind>', which the outbox and every webhook receiver key on", () => {
    const opened = Workspace.open(ws, "Acme", founder, at);
    if (!isOk(opened)) throw new Error("open should succeed");
    const [event] = opened.value.events;
    if (event === undefined) throw new Error("opening emits an event");
    expect(tenancyEventType(event)).toBe("tenancy.WorkspaceOpened");
  });
});
