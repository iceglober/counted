/**
 * Workspace — the tenancy root.
 *
 * It owns the plan, the payment standing, the limits those confer, and the
 * register of projects that consume them. It does **not** own membership: a
 * better-auth `organization` row and a `Workspace` row share an id and answer
 * different questions — "who belongs here, with what role" versus "what plan,
 * what limits, what is owed". Membership is read through `MembershipDirectory`
 * and written only through better-auth's API, so the seat count arrives here as
 * a number the caller measured rather than as state this aggregate keeps and
 * lets go stale.
 *
 * **Limits are derived, never stored.** The workspace holds `plan` and
 * `payment` and asks `Entitlement.resolve` what they mean, every time. v2
 * stored a `WorkspaceLimits` alongside them, which let the two disagree — and
 * did: the Postgres adapter loaded every workspace with
 * `limits: WorkspaceLimits.UNLIMITED` because the entitlement was resolved
 * somewhere else, so a rehydrated workspace enforced no cap at all. One
 * source, resolved on read, cannot drift.
 *
 * Invariants held here:
 *   1. A workspace has a non-empty name.
 *   2. A project consumes a slot exactly while it is active — one rule,
 *      `project-count.ts`, used by admission, restoration and reporting alike.
 *   3. The active project count never exceeds the entitled cap as a result of
 *      anything this aggregate does. A *downgrade* can leave it over, and that
 *      is reported as an event rather than resolved by deleting data.
 */

import { err, ok, type AccountId, type Instant, type ProjectId, type Result, type WorkspaceId } from "@counted/kernel";
import { Entitlement, type PaymentState } from "./entitlement";
import type { WorkspaceError } from "./errors";
import type { WorkspaceEvent } from "./events";
import { WorkspaceLimits } from "./limits";
import type { PlanId } from "./plan";
import { countAgainstCap, findProject, type ProjectEntry } from "./project-count";

/** What the payment provider has told us, reduced to the two facts that matter. */
export type WorkspaceStanding = {
  readonly plan: PlanId;
  readonly payment: PaymentState;
};

/**
 * How many people are in the workspace right now.
 *
 * A value, not state. It comes from `MembershipDirectory` at the moment the
 * caller asks, because the member table belongs to better-auth and a copy kept
 * here would be a second answer to a question somebody else owns.
 */
export type Occupancy = { readonly seats: number };

export type WorkspaceSnapshot = {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly plan: PlanId;
  readonly payment: PaymentState;
  readonly projects: readonly ProjectEntry[];
};

/** What a command produced: the new state plus the events it emitted. */
export type WorkspaceApplied = {
  readonly workspace: Workspace;
  readonly events: readonly WorkspaceEvent[];
};

/** How much of the seat allowance is spoken for. */
export type SeatAllowance = { readonly used: number; readonly limit: number | null };

export class Workspace {
  private constructor(
    readonly id: WorkspaceId,
    readonly name: string,
    private readonly plan_: PlanId,
    private readonly payment_: PaymentState,
    private readonly projects_: readonly ProjectEntry[],
  ) {}

  /**
   * Open a workspace.
   *
   * Always on the free plan with no payment standing: a workspace exists before
   * anyone has been to checkout, and pretending otherwise would mean the
   * creation path could mint a paid entitlement without a payment. The founder
   * appears on the event and nowhere else — their membership is better-auth's
   * to create, in the same transaction, by the caller.
   */
  static open(
    id: WorkspaceId,
    name: string,
    founder: AccountId,
    at: Instant,
  ): Result<WorkspaceApplied, WorkspaceError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });

    return ok({
      workspace: new Workspace(id, trimmed, "free", "none", []),
      events: [{ kind: "WorkspaceOpened", workspace: id, founder, at }],
    });
  }

  /** Rehydrate from storage. No events; this is not a state change. */
  static rehydrate(s: WorkspaceSnapshot): Workspace {
    return new Workspace(s.id, s.name, s.plan, s.payment, s.projects);
  }

  snapshot(): WorkspaceSnapshot {
    return {
      id: this.id,
      name: this.name,
      plan: this.plan_,
      payment: this.payment_,
      projects: this.projects_,
    };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  /** The plan the customer bought. What they currently *get* is `entitlement`. */
  get plan(): PlanId {
    return this.plan_;
  }

  get payment(): PaymentState {
    return this.payment_;
  }

  /** The one answer to "what is this workspace allowed to do". */
  get entitlement(): Entitlement {
    return Entitlement.resolve(this.plan_, this.payment_);
  }

  get limits(): WorkspaceLimits {
    return Entitlement.toWorkspaceLimits(this.entitlement);
  }

  /** Every registered project, archived ones included. */
  get projects(): readonly ProjectEntry[] {
    return this.projects_;
  }

  /**
   * How many slots are consumed. The only project count in the system — the
   * cap check, the downgrade report and the usage readout all call this one.
   */
  get projectCount(): number {
    return countAgainstCap(this.projects_);
  }

  // ── commands ─────────────────────────────────────────────────────────────

  /** Rename. A no-op rename is the outcome the caller asked for, so it succeeds silently. */
  rename(name: string, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (trimmed === this.name) return ok({ workspace: this, events: [] });

    return ok({
      workspace: new Workspace(this.id, trimmed, this.plan_, this.payment_, this.projects_),
      events: [{ kind: "WorkspaceRenamed", workspace: this.id, name: trimmed, at }],
    });
  }

  /**
   * Register a project against the cap. The Project aggregate is created
   * separately, in the same transaction; this is the workspace agreeing that it
   * may exist.
   *
   * v1 enforced its project cap in exactly one of three creation paths, so
   * provisioning and claiming both walked past it. Here there is one path,
   * because there is one place a project can become active.
   */
  registerProject(
    id: ProjectId,
    name: string,
    at: Instant,
  ): Result<WorkspaceApplied, WorkspaceError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (findProject(this.projects_, id) !== undefined) {
      return err({ kind: "ProjectExists", project: id });
    }

    const capped = this.refuseIfFull();
    if (capped !== null) return err(capped);

    const entry: ProjectEntry = { id, name: trimmed, state: "active" };
    return ok({
      workspace: this.with({ projects: [...this.projects_, entry] }),
      events: [
        { kind: "ProjectProvisioned", workspace: this.id, project: id, name: trimmed, at },
      ],
    });
  }

  /** Archiving frees the slot. The project and its data stay. */
  archiveProject(id: ProjectId, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    const entry = findProject(this.projects_, id);
    if (entry === undefined) return err({ kind: "NoSuchProject", project: id });
    if (entry.state === "archived") return err({ kind: "ProjectAlreadyArchived", project: id });

    return ok({
      workspace: this.with({ projects: this.replace(id, { ...entry, state: "archived" }) }),
      events: [{ kind: "ProjectArchived", workspace: this.id, project: id, at }],
    });
  }

  /**
   * Bring an archived project back — which is a cap decision, not an undo.
   *
   * The slot freed by archiving can have been taken since. Without this check
   * archive-then-restore is a way to hold more active projects than the plan
   * allows, and it would be the same rule enforced in one direction only.
   */
  restoreProject(id: ProjectId, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    const entry = findProject(this.projects_, id);
    if (entry === undefined) return err({ kind: "NoSuchProject", project: id });
    if (entry.state === "active") return err({ kind: "ProjectNotArchived", project: id });

    const capped = this.refuseIfFull();
    if (capped !== null) return err(capped);

    return ok({
      workspace: this.with({ projects: this.replace(id, { ...entry, state: "active" }) }),
      events: [{ kind: "ProjectRestored", workspace: this.id, project: id, at }],
    });
  }

  /**
   * Drop a project from the register entirely, because it was deleted.
   *
   * Distinct from archiving: an archived project still exists and can come
   * back. A deleted one that stayed in the register would hold a slot forever —
   * a customer who deletes a project and cannot create another has no way to
   * discover why.
   */
  deregisterProject(id: ProjectId, at: Instant): Result<WorkspaceApplied, WorkspaceError> {
    if (findProject(this.projects_, id) === undefined) {
      return err({ kind: "NoSuchProject", project: id });
    }

    return ok({
      workspace: this.with({ projects: this.projects_.filter((p) => p.id !== id) }),
      events: [{ kind: "ProjectDeregistered", workspace: this.id, project: id, at }],
    });
  }

  /**
   * May one more person be seated?
   *
   * Asked before better-auth is told to add a member, because better-auth knows
   * nothing about plans. The current count is passed in — see `Occupancy`.
   */
  mayAdmitSeat(occupancy: Occupancy): Result<SeatAllowance, WorkspaceError> {
    const { maxSeats } = this.limits;
    const breached = WorkspaceLimits.breached(occupancy.seats, maxSeats);
    if (breached !== null) return err({ kind: "SeatLimitReached", limit: breached });
    return ok({ used: occupancy.seats, limit: maxSeats });
  }

  /**
   * Adopt what the payment provider says, and report what that costs.
   *
   * Deliberately destroys nothing. A downgrade that leaves the workspace over
   * its cap emits `OverProjectLimit` and stops; silently deleting a customer's
   * projects because a card expired is not a decision an aggregate should make.
   *
   * Emits nothing at all when nothing changed, which is what makes a redelivered
   * webhook a true no-op rather than a duplicate notification.
   */
  applyStanding(standing: WorkspaceStanding, occupancy: Occupancy, at: Instant): WorkspaceApplied {
    const before = this.limits;
    const next = new Workspace(
      this.id,
      this.name,
      standing.plan,
      standing.payment,
      this.projects_,
    );
    const after = next.limits;

    const events: WorkspaceEvent[] = [];
    if (standing.plan !== this.plan_) {
      events.push({
        kind: "PlanChanged",
        workspace: this.id,
        from: this.plan_,
        to: standing.plan,
        at,
      });
    }
    if (standing.payment !== this.payment_) {
      events.push({
        kind: "PaymentStateChanged",
        workspace: this.id,
        from: this.payment_,
        to: standing.payment,
        at,
      });
    }

    if (!WorkspaceLimits.equal(before, after)) {
      events.push({ kind: "LimitsChanged", workspace: this.id, limits: after, at });

      const active = next.projectCount;
      const overProjects = WorkspaceLimits.over(active, after.maxProjects);
      if (overProjects !== null) {
        events.push({ kind: "OverProjectLimit", workspace: this.id, active, limit: overProjects, at });
      }
      const overSeats = WorkspaceLimits.over(occupancy.seats, after.maxSeats);
      if (overSeats !== null) {
        events.push({
          kind: "OverSeatLimit",
          workspace: this.id,
          seats: occupancy.seats,
          limit: overSeats,
          at,
        });
      }
    }

    return { workspace: next, events };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The cap check, written once so admission and restoration cannot diverge. */
  private refuseIfFull(): WorkspaceError | null {
    const breached = WorkspaceLimits.breached(this.projectCount, this.limits.maxProjects);
    return breached === null ? null : { kind: "ProjectLimitReached", limit: breached };
  }

  private replace(id: ProjectId, entry: ProjectEntry): readonly ProjectEntry[] {
    return this.projects_.map((p) => (p.id === id ? entry : p));
  }

  private with(patch: { projects?: readonly ProjectEntry[] }): Workspace {
    return new Workspace(
      this.id,
      this.name,
      this.plan_,
      this.payment_,
      patch.projects ?? this.projects_,
    );
  }
}
