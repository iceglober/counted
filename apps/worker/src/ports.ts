/**
 * Capabilities used by the worker's scheduled jobs.
 *
 * OrganizationDirectory and EventRetention are re-exported from their owning
 * contexts. The remaining enumeration ports have one consumer here today:
 *
 *   - `RecentProjects` belongs in `@counted/projects-ports` too, and for the
 *     same reason as `RetentionTargets`: a reconciler has no workspace to
 *     start a `listForWorkspace` from.
 *   - `RetentionTargets` belongs in `@counted/projects-ports`. Neither
 *     `ProjectRepository` nor `WorkspaceRepository` can enumerate: they answer
 *     `find` and `listForWorkspace`, and a sweep has no workspace to start from.
 *   - `EventRetention` has moved to `@counted/analytics-ports` and is
 *     re-exported below; `LiticsEventRetention` in the analytics adapter
 *     implements it.
 *
 * Each job below is written against the interface and tested against a fake, so
 * moving one is a re-export and a deletion. Where no implementation exists, the
 * job reports `unavailable` — it does not guess, and it does not quietly do
 * nothing while looking healthy.
 */

import type { Instant, ProjectId, WorkspaceId } from "@counted/kernel";
import type { PaymentState, PlanId } from "@counted/tenancy-domain";
import type { RetentionPolicy } from "@counted/projects-domain";

// ── identity ───────────────────────────────────────────────────────────────

/**
 * A better-auth organization, as the reconciler needs to see it.
 *
 * `workspace` is the organization's own id: the two halves of a workspace share
 * one id by construction (see `betterAuthWorkspaceProvisioner`), which is what
 * makes "is there a domain row for this organization" a primary-key lookup
 * rather than a name match.
 *
 * `owner` is nullable because the orphan case includes a half-written
 * provision: an organization row committed with no `member` row behind it. That
 * one cannot be repaired — there is nobody to be the founder — and saying so is
 * the whole value of reporting it.
 */
export type { OrganizationDirectory, OrganizationRecord } from "@counted/identity-ports";

/**
 * A claimed project, as the provisioning reconciler needs to see it.
 *
 * `createdAt` is the project row's, which is what makes "recent enough that a
 * crash could still explain this" answerable without a second table.
 */
export type ProjectRecord = {
  readonly project: ProjectId;
  readonly workspace: WorkspaceId;
  readonly name: string;
  readonly createdAt: Instant;
};

export interface RecentProjects {
  /** Claimed, unarchived projects created at or after `since`, oldest first. */
  createdSince(since: Instant, limit: number): Promise<readonly ProjectRecord[]>;
}

// ── retention ──────────────────────────────────────────────────────────────

/**
 * Everything the cutoff arithmetic needs about one project, in one row.
 *
 * The plan and the payment state travel together because `Entitlement.resolve`
 * needs both: a `past_due` workspace keeps its paid retention, a `canceled` one
 * drops to free, and reading only the plan column is exactly the v1 bug where a
 * past-due customer kept unlimited projects while being metered as free.
 */
export type RetentionTarget = {
  readonly project: ProjectId;
  readonly workspace: WorkspaceId;
  readonly plan: PlanId;
  readonly payment: PaymentState;
  readonly policy: RetentionPolicy;
};

/**
 * One page of a key-ordered walk.
 *
 * `cursor` is carried rather than derived from the last target because a row
 * the store could not read is still a row that was passed: resuming from the
 * last *readable* id would re-read the unreadable one forever, and stopping
 * when `targets` is short would end the sweep at the first bad row. `examined`
 * exists so the difference is reportable instead of invisible.
 */
export type RetentionPage = {
  readonly targets: readonly RetentionTarget[];
  /** Rows the store returned, readable or not. */
  readonly examined: number;
  /** Resume after this id, or `null` when the store had nothing more. */
  readonly cursor: ProjectId | null;
};

export interface RetentionTargets {
  /** Claimed projects, ordered by id, starting after `afterProject`. */
  page(afterProject: ProjectId | null, limit: number): Promise<RetentionPage>;
}

export type { EventRetention, PurgeFailure, PurgeRequest } from "@counted/analytics-ports";

/**
 * What the maintenance check asks the compactor: how far behind is packing.
 * The analytics adapter's compactor satisfies it.
 */
export interface CompactorStatusSource {
  status(): Promise<{
    readonly listening: boolean;
    readonly streams: readonly { readonly stream: string; readonly stagingRows: number; readonly oldestStagedMs: number }[];
  }>;
}

// ── observability ──────────────────────────────────────────────────────────

/** Fields on a log line. Flat on purpose — this ends up as one JSON object. */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Where the worker says what it did.
 *
 * A port and not `console.log` because half of what this process does is
 * invisible otherwise: nothing returns to a caller, so a job that silently
 * evaluated nothing for a week looks exactly like a job with nothing to do.
 */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}
