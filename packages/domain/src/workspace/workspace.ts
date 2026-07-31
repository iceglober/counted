/**
 * Workspace — the tenancy root.
 *
 * It owns projects, memberships, and (later) the subscription. Dashboards hang
 * off it too, which is what dissolves v1's worst structural bug: a dashboard
 * there was owned by a user, defaulted per project, and permitted a NULL owner,
 * so `if (existing.userId && existing.userId !== session.user.id)` meant a
 * dashboard with no owner was readable, editable and shareable by anybody.
 *
 * Invariants held here:
 *   1. A workspace always has at least one owner.
 *   2. An account holds at most one membership.
 *   3. Seats and projects stay within the entitled limits.
 *   4. Only an existing member can be re-roled or removed.
 *
 * Limits arrive as a value. The workspace enforces them but does not know what
 * a "plan" is, and it certainly does not know what Stripe is — that mapping is
 * PlanCatalog's job (#29).
 */

import { err, ok, type Result } from "../shared/result";
import type { AccountId, ProjectId, WorkspaceId } from "../shared/ids";
import type { Instant } from "../shared/instant";
import { Membership, Role } from "./membership";
import type { WorkspaceError } from "./errors";
import type { WorkspaceEvent } from "./events";

/** The slots a workspace is entitled to. `null` means unlimited. */
export type WorkspaceLimits = {
  readonly maxProjects: number | null;
  readonly maxSeats: number | null;
};

export const WorkspaceLimits = {
  UNLIMITED: { maxProjects: null, maxSeats: null } as WorkspaceLimits,
  of: (maxProjects: number | null, maxSeats: number | null): WorkspaceLimits => ({
    maxProjects,
    maxSeats,
  }),
} as const;

export type ProjectState = "active" | "archived";

/**
 * The workspace's view of a project: enough to enforce the cap and to name
 * things, not the project itself. The Project aggregate (#20) owns credentials,
 * retention, and its own lifecycle.
 */
export type ProjectEntry = {
  readonly id: ProjectId;
  readonly name: string;
  readonly state: ProjectState;
};

export type WorkspaceSnapshot = {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly memberships: readonly Membership[];
  readonly projects: readonly ProjectEntry[];
  readonly limits: WorkspaceLimits;
};

/** What a command produced: the new state plus the events it emitted. */
export type WorkspaceApplied = { readonly workspace: Workspace; readonly events: readonly WorkspaceEvent[] };

export class Workspace {
  private constructor(
    readonly id: WorkspaceId,
    readonly name: string,
    private readonly members: ReadonlyMap<AccountId, Membership>,
    private readonly projects: readonly ProjectEntry[],
    readonly limits: WorkspaceLimits,
  ) {}

  /**
   * Open a workspace. The founder is its first owner — a workspace is never
   * ownerless, not even for an instant.
   */
  static open(
    id: WorkspaceId,
    name: string,
    founder: AccountId,
    limits: WorkspaceLimits,
    at: Instant,
  ): Result<WorkspaceApplied, WorkspaceError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });

    const founding = Membership.create(founder, "owner", at);
    const workspace = new Workspace(
      id,
      trimmed,
      new Map([[founder, founding]]),
      [],
      limits,
    );
    return ok({
      workspace,
      events: [{ kind: "WorkspaceOpened", workspace: id, founder, at }],
    });
  }

  /** Rehydrate from storage. No events; this is not a state change. */
  static rehydrate(s: WorkspaceSnapshot): Workspace {
    return new Workspace(
      s.id,
      s.name,
      new Map(s.memberships.map((m) => [m.account, m])),
      s.projects,
      s.limits,
    );
  }

  snapshot(): WorkspaceSnapshot {
    return {
      id: this.id,
      name: this.name,
      memberships: [...this.members.values()],
      projects: this.projects,
      limits: this.limits,
    };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  membership(account: AccountId): Membership | undefined {
    return this.members.get(account);
  }

  roleOf(account: AccountId): Role | undefined {
    return this.members.get(account)?.role;
  }

  /** Authorization asks this, never the raw role. */
  can(account: AccountId, capability: (r: Role) => boolean): boolean {
    const role = this.roleOf(account);
    return role !== undefined && capability(role);
  }

  get memberCount(): number {
    return this.members.size;
  }

  get ownerCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.role === "owner") n++;
    return n;
  }

  activeProjects(): readonly ProjectEntry[] {
    return this.projects.filter((p) => p.state === "active");
  }

  // ── commands ─────────────────────────────────────────────────────────────

  /**
   * Admit an account. The seat cap is checked here rather than at three
   * different call sites — v1 enforced its project cap in exactly one of the
   * three creation paths, so provisioning and claiming both bypassed it.
   */
  admit(account: AccountId, role: Role, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    if (this.members.has(account)) return err({ kind: "AlreadyAMember", account });

    const { maxSeats } = this.limits;
    if (maxSeats !== null && this.members.size >= maxSeats) {
      return err({ kind: "SeatLimitReached", limit: maxSeats });
    }

    const next = new Map(this.members);
    next.set(account, Membership.create(account, role, at));
    return ok({
      workspace: this.with({ members: next }),
      events: [{ kind: "MemberAdmitted", workspace: this.id, account, role, at }],
    });
  }

  changeRole(account: AccountId, role: Role, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    const current = this.members.get(account);
    if (current === undefined) return err({ kind: "NotAMember", account });
    if (current.role === role) return err({ kind: "RoleUnchanged", account, role });

    if (current.role === "owner" && this.ownerCount === 1) {
      return err({ kind: "LastOwner", account });
    }

    const next = new Map(this.members);
    next.set(account, Membership.withRole(current, role));
    return ok({
      workspace: this.with({ members: next }),
      events: [
        { kind: "RoleChanged", workspace: this.id, account, from: current.role, to: role, at },
      ],
    });
  }

  remove(account: AccountId, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    const current = this.members.get(account);
    if (current === undefined) return err({ kind: "NotAMember", account });

    if (current.role === "owner" && this.ownerCount === 1) {
      return err({ kind: "LastOwner", account });
    }

    const next = new Map(this.members);
    next.delete(account);
    return ok({
      workspace: this.with({ members: next }),
      events: [{ kind: "MemberRemoved", workspace: this.id, account, at }],
    });
  }

  /**
   * Register a project against the cap. The Project aggregate is created
   * separately; this is the workspace agreeing that it may exist.
   *
   * Archived projects do not consume a slot.
   */
  provisionProject(
    id: ProjectId,
    name: string,
    at: Instant,
  ): Result<WorkspaceApplied, WorkspaceError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (this.projects.some((p) => p.id === id)) return err({ kind: "ProjectExists", project: id });

    const { maxProjects } = this.limits;
    if (maxProjects !== null && this.activeProjects().length >= maxProjects) {
      return err({ kind: "ProjectLimitReached", limit: maxProjects });
    }

    const entry: ProjectEntry = { id, name: trimmed, state: "active" };
    return ok({
      workspace: this.with({ projects: [...this.projects, entry] }),
      events: [{ kind: "ProjectProvisioned", workspace: this.id, project: id, name: trimmed, at }],
    });
  }

  archiveProject(id: ProjectId, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    const entry = this.projects.find((p) => p.id === id);
    if (entry === undefined) return err({ kind: "NoSuchProject", project: id });
    if (entry.state === "archived") return err({ kind: "ProjectAlreadyArchived", project: id });

    const projects = this.projects.map((p): ProjectEntry =>
      p.id === id ? { ...p, state: "archived" } : p,
    );
    return ok({
      workspace: this.with({ projects }),
      events: [{ kind: "ProjectArchived", workspace: this.id, project: id, at }],
    });
  }

  /**
   * Apply new limits, e.g. after a downgrade. This deliberately does NOT delete
   * anything. It reports whether the workspace is now over its allowance and
   * lets a policy decide what happens — silently destroying a customer's
   * projects because a card expired is not a decision an aggregate should make.
   */
  applyLimits(limits: WorkspaceLimits, at: Instant): WorkspaceApplied {
    const events: WorkspaceEvent[] = [
      { kind: "LimitsChanged", workspace: this.id, limits, at },
    ];

    const activeCount = this.activeProjects().length;
    if (limits.maxProjects !== null && activeCount > limits.maxProjects) {
      events.push({
        kind: "OverProjectLimit",
        workspace: this.id,
        active: activeCount,
        limit: limits.maxProjects,
        at,
      });
    }
    if (limits.maxSeats !== null && this.members.size > limits.maxSeats) {
      events.push({
        kind: "OverSeatLimit",
        workspace: this.id,
        seats: this.members.size,
        limit: limits.maxSeats,
        at,
      });
    }

    return { workspace: this.with({ limits }), events };
  }

  private with(patch: {
    members?: ReadonlyMap<AccountId, Membership>;
    projects?: readonly ProjectEntry[];
    limits?: WorkspaceLimits;
  }): Workspace {
    return new Workspace(
      this.id,
      this.name,
      patch.members ?? this.members,
      patch.projects ?? this.projects,
      patch.limits ?? this.limits,
    );
  }
}
