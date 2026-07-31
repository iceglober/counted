/**
 * `retention.purge` — delete events past the retention the customer was sold.
 *
 * This ships a feature that has been on the pricing page since launch and has
 * never existed. v1 had no purge job, no retention column, and no worker to
 * run one in, so "6 months on Free, 24 on Pro" described nothing.
 *
 * Two phases, because partitions are global and retention is per-plan:
 *
 *   **Drop whole months** that are past the *longest* retention any plan
 *   grants. Instant, no vacuum, no lock on live data — and safe for everyone,
 *   because by then nobody is entitled to any row in them.
 *
 *   **Purge rows per project** for plans with shorter retention. A free
 *   workspace's events between six months and two years sit inside partitions
 *   a paying customer still needs, so they cannot be dropped with the month.
 *
 * Only doing the first would keep free-plan data for two years while the page
 * says six months. For a product whose whole claim is restraint about data,
 * that is the wrong direction to be wrong in.
 *
 * Every deletion here is irreversible, so the decision about what has expired
 * is made by the domain and this handler only carries it out. A partition is
 * dropped only when its *entire* range is past the cutoff — dropping the one
 * containing the cutoff would delete data the customer is still entitled to,
 * which is the kind of off-by-one you cannot undo.
 */

import { Entitlement, Instant, globalPurgeCutoff, needsRowPurge, retentionCutoff } from "@counted/domain";
import type { PartitionMaintenance, RetentionMaintenance } from "@counted/ports";
import { expiredPartitions } from "@counted/adapter-postgres";
import type { Handler } from "../runtime";

/** Rows deleted per project per run. Bounded so no transaction runs long. */
export const PURGE_BATCH = 50_000;

/**
 * How many projects to purge in one run.
 *
 * The job runs every six hours, so a backlog unwinds over a day rather than in
 * one enormous pass. Purging every project every run would make a job whose
 * duration grows with the customer count.
 */
export const PROJECTS_PER_RUN = 50;

export type RetentionDeps = {
  readonly partitions: PartitionMaintenance;
  readonly retention: RetentionMaintenance;
};

export const retentionPurge = (deps: RetentionDeps): Handler => async (_job, context) => {
  const cutoff = globalPurgeCutoff(context.now);

  let droppedPartitions = 0;
  if (cutoff !== null) {
    // Only whole partitions past the longest retention anyone holds. A
    // partition straddling the cutoff is left alone — its live half is data
    // someone is still entitled to.
    const expired = expiredPartitions(await deps.partitions.list(), cutoff);
    for (const spec of expired) {
      await deps.retention.dropPartition(spec.name);
      context.log.info("retention.partition_dropped", { partition: spec.name, cutoff: Instant.toISO(cutoff) });
      droppedPartitions += 1;
    }
  }

  // Now the plans whose retention is shorter than that. Their old events live
  // inside partitions that are still needed, so they go row by row.
  const projects = await deps.retention.projectsWithPlans();
  let purgedRows = 0;
  let projectsPurged = 0;
  let more = false;

  for (const record of projects) {
    if (projectsPurged >= PROJECTS_PER_RUN) {
      more = true;
      break;
    }

    // An unrecognised plan would shorten this project's retention, which is
    // the one place where falling back to free deletes data instead of merely
    // withholding an allowance. Skip it and say so; a human decides.
    if (!PLANS.includes(record.plan)) {
      context.log.error("retention.unknown_plan", {
        projectId: String(record.project),
        plan: record.plan,
        detail: "skipped rather than purged at the free-plan cutoff",
      });
      continue;
    }

    // The entitlement decides, not the stored plan id. A past_due workspace
    // keeps its plan — and therefore its retention — which is the same rule
    // the rest of the system applies, rather than a second one here.
    const entitlement = Entitlement.resolve(planOf(record.plan), paymentOf(record.payment));
    if (!needsRowPurge(entitlement)) continue;

    const projectCutoff = retentionCutoff(entitlement, context.now);
    if (projectCutoff === null) continue;

    const deleted = await deps.retention.purgeProject(record.project, projectCutoff, PURGE_BATCH);
    if (deleted === 0) continue;

    purgedRows += deleted;
    projectsPurged += 1;
    // A full batch means there is more of this project's history to delete.
    if (deleted >= PURGE_BATCH) more = true;

    context.log.info("retention.rows_purged", {
      projectId: String(record.project),
      rows: deleted,
      plan: entitlement.plan,
      olderThan: Instant.toISO(projectCutoff),
    });
  }

  if (droppedPartitions === 0 && purgedRows === 0) {
    return { kind: "noop", detail: "nothing past its retention" };
  }

  return {
    kind: "done",
    detail: `dropped ${droppedPartitions} partitions, purged ${purgedRows} rows${more ? " (more remain)" : ""}`,
  };
};

const PLANS: readonly string[] = ["free", "pro"];
const PAYMENTS: readonly string[] = ["none", "active", "past_due", "canceled"];

/**
 * Narrowing, for values already checked against `PLANS` above.
 *
 * The check is in the caller rather than here on purpose: everywhere else in
 * the system an unrecognised plan falls back to free, because withholding a
 * paid allowance is recoverable. Here it would *delete data sooner*, so the
 * only safe response is to skip the project and report it.
 */
const planOf = (raw: string) => raw as "free" | "pro";
const paymentOf = (raw: string) =>
  PAYMENTS.includes(raw) ? (raw as "none" | "active" | "past_due" | "canceled") : "none";
