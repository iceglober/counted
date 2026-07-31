import { describe, expect, test } from "bun:test";
import { AccountId, ProjectId, WorkspaceId } from "../shared/ids";
import { Duration, Instant } from "../shared";
import { Role } from "./membership";
import { Workspace, WorkspaceLimits } from "./workspace";
import type { WorkspaceError } from "./errors";

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const later = Instant.plus(t0, Duration.days(1));

const ws = WorkspaceId("ws_1");
const alice = AccountId("acc_alice");
const bob = AccountId("acc_bob");
const carol = AccountId("acc_carol");

/** Unwrap an expected success; fail loudly rather than silently continuing. */
const must = <T>(r: { ok: true; value: T } | { ok: false; error: WorkspaceError }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errorOf = <T>(
  r: { ok: true; value: T } | { ok: false; error: WorkspaceError },
): WorkspaceError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r.error;
};

const open = (limits: WorkspaceLimits = WorkspaceLimits.UNLIMITED) =>
  must(Workspace.open(ws, "Acme", alice, limits, t0)).workspace;

describe("opening a workspace", () => {
  test("the founder is its first owner — never ownerless, not even briefly", () => {
    const { workspace, events } = must(
      Workspace.open(ws, "Acme", alice, WorkspaceLimits.UNLIMITED, t0),
    );
    expect(workspace.ownerCount).toBe(1);
    expect(workspace.roleOf(alice)).toBe("owner");
    expect(events).toEqual([{ kind: "WorkspaceOpened", workspace: ws, founder: alice, at: t0 }]);
  });

  test("a blank name is rejected", () => {
    const r = Workspace.open(ws, "   ", alice, WorkspaceLimits.UNLIMITED, t0);
    expect(errorOf(r).kind).toBe("NameRequired");
  });

  test("the name is trimmed", () => {
    expect(must(Workspace.open(ws, "  Acme  ", alice, WorkspaceLimits.UNLIMITED, t0)).workspace.name).toBe("Acme");
  });
});

describe("membership", () => {
  test("admitting a member emits the fact", () => {
    const { workspace, events } = must(open().admit(bob, "member", later));
    expect(workspace.memberCount).toBe(2);
    expect(workspace.roleOf(bob)).toBe("member");
    expect(events[0]).toMatchObject({ kind: "MemberAdmitted", account: bob, role: "member" });
  });

  test("an account cannot hold two memberships", () => {
    const w = must(open().admit(bob, "member", later)).workspace;
    expect(errorOf(w.admit(bob, "admin", later)).kind).toBe("AlreadyAMember");
  });

  test("the seat cap is enforced in the aggregate, not at the call site", () => {
    const w = open(WorkspaceLimits.of(null, 2));
    const two = must(w.admit(bob, "member", later)).workspace;
    const e = errorOf(two.admit(carol, "member", later));
    expect(e).toEqual({ kind: "SeatLimitReached", limit: 2 });
  });

  test("re-roling and removing require an existing membership", () => {
    const w = open();
    expect(errorOf(w.changeRole(bob, "admin", later)).kind).toBe("NotAMember");
    expect(errorOf(w.remove(bob, later)).kind).toBe("NotAMember");
  });

  test("a no-op role change is rejected rather than silently emitting an event", () => {
    const w = must(open().admit(bob, "member", later)).workspace;
    expect(errorOf(w.changeRole(bob, "member", later)).kind).toBe("RoleUnchanged");
  });
});

describe("the last-owner invariant", () => {
  test("the only owner cannot be demoted", () => {
    const w = must(open().admit(bob, "admin", later)).workspace;
    expect(errorOf(w.changeRole(alice, "admin", later))).toEqual({ kind: "LastOwner", account: alice });
  });

  test("the only owner cannot be removed", () => {
    const w = must(open().admit(bob, "admin", later)).workspace;
    expect(errorOf(w.remove(alice, later))).toEqual({ kind: "LastOwner", account: alice });
  });

  test("with a second owner present, the first may leave", () => {
    const two = must(open().admit(bob, "owner", later)).workspace;
    expect(two.ownerCount).toBe(2);
    const after = must(two.remove(alice, later)).workspace;
    expect(after.ownerCount).toBe(1);
    expect(after.roleOf(alice)).toBeUndefined();
  });

  test("demoting one of two owners is allowed; demoting the survivor is not", () => {
    const two = must(open().admit(bob, "owner", later)).workspace;
    const one = must(two.changeRole(bob, "admin", later)).workspace;
    expect(one.ownerCount).toBe(1);
    expect(errorOf(one.changeRole(alice, "member", later)).kind).toBe("LastOwner");
  });
});

describe("projects", () => {
  const p1 = ProjectId("prj_1");
  const p2 = ProjectId("prj_2");

  test("provisioning registers the project and emits the fact", () => {
    const { workspace, events } = must(open().provisionProject(p1, "Web", later));
    expect(workspace.activeProjects()).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "ProjectProvisioned", project: p1, name: "Web" });
  });

  test("the project cap is enforced — v1 enforced it in one of three creation paths", () => {
    const w = must(open(WorkspaceLimits.of(1, null)).provisionProject(p1, "Web", later)).workspace;
    expect(errorOf(w.provisionProject(p2, "Mobile", later))).toEqual({
      kind: "ProjectLimitReached",
      limit: 1,
    });
  });

  test("archiving frees a slot", () => {
    const capped = WorkspaceLimits.of(1, null);
    const one = must(open(capped).provisionProject(p1, "Web", later)).workspace;
    const archived = must(one.archiveProject(p1, later)).workspace;
    expect(archived.activeProjects()).toHaveLength(0);
    expect(must(archived.provisionProject(p2, "Mobile", later)).workspace.activeProjects()).toHaveLength(1);
  });

  test("archiving is not idempotent — a second attempt is an error, not a silent no-op", () => {
    const one = must(open().provisionProject(p1, "Web", later)).workspace;
    const archived = must(one.archiveProject(p1, later)).workspace;
    expect(errorOf(archived.archiveProject(p1, later)).kind).toBe("ProjectAlreadyArchived");
  });

  test("unknown project ids are rejected", () => {
    expect(errorOf(open().archiveProject(p1, later)).kind).toBe("NoSuchProject");
  });
});

describe("limits changing under the workspace", () => {
  test("a downgrade reports the overage instead of deleting anything", () => {
    const p1 = ProjectId("prj_1");
    const p2 = ProjectId("prj_2");
    const w0 = must(open().provisionProject(p1, "Web", later)).workspace;
    const w1 = must(w0.provisionProject(p2, "Mobile", later)).workspace;

    const { workspace, events } = w1.applyLimits(WorkspaceLimits.of(1, null), later);

    // Nothing was destroyed.
    expect(workspace.activeProjects()).toHaveLength(2);
    expect(events.map((e) => e.kind)).toEqual(["LimitsChanged", "OverProjectLimit"]);
    expect(events[1]).toMatchObject({ active: 2, limit: 1 });
  });

  test("an upgrade emits only the change", () => {
    const { events } = open(WorkspaceLimits.of(1, 1)).applyLimits(WorkspaceLimits.UNLIMITED, later);
    expect(events.map((e) => e.kind)).toEqual(["LimitsChanged"]);
  });

  test("seat overage is reported too", () => {
    const w = must(open().admit(bob, "member", later)).workspace;
    const { events } = w.applyLimits(WorkspaceLimits.of(null, 1), later);
    expect(events.map((e) => e.kind)).toEqual(["LimitsChanged", "OverSeatLimit"]);
  });
});

describe("capabilities", () => {
  test("authorization asks for a capability, not a raw role", () => {
    const w = must(must(open().admit(bob, "admin", later)).workspace.admit(carol, "member", later)).workspace;

    expect(w.can(alice, Role.canManageBilling)).toBe(true);
    expect(w.can(bob, Role.canManageBilling)).toBe(false);
    expect(w.can(bob, Role.canManageProjects)).toBe(true);
    expect(w.can(carol, Role.canManageProjects)).toBe(false);

    // A non-member has no capabilities at all.
    expect(w.can(AccountId("acc_stranger"), Role.canManageProjects)).toBe(false);
  });
});

describe("rehydration", () => {
  test("snapshot round-trips through storage without changing behaviour", () => {
    const built = must(must(open(WorkspaceLimits.of(3, 5)).admit(bob, "admin", later)).workspace
      .provisionProject(ProjectId("prj_1"), "Web", later)).workspace;

    const revived = Workspace.rehydrate(built.snapshot());

    expect(revived.memberCount).toBe(built.memberCount);
    expect(revived.ownerCount).toBe(built.ownerCount);
    expect(revived.activeProjects()).toEqual(built.activeProjects());
    expect(revived.roleOf(bob)).toBe("admin");
    // And the invariants still hold after revival.
    expect(errorOf(revived.remove(alice, later)).kind).toBe("LastOwner");
  });
});

describe("immutability", () => {
  test("commands return a new workspace and leave the original untouched", () => {
    const before = open();
    const after = must(before.admit(bob, "member", later)).workspace;
    expect(before.memberCount).toBe(1);
    expect(after.memberCount).toBe(2);
  });
});
