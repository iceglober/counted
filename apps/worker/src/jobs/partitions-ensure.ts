/**
 * `partitions.ensure` — make sure the months we are about to write to exist.
 *
 * The failure mode this prevents is specific and unpleasant: at midnight on
 * the 1st, every insert for the new month has no partition to land in. With a
 * default partition it silently lands there, defeating retention and pruning
 * forever; without one, ingestion stops entirely. Neither is a thing to
 * discover from a customer.
 *
 * Creating a partition is `CREATE TABLE IF NOT EXISTS`, so this job is safe to
 * run on every replica, twice, in the same minute — which is exactly what the
 * runtime's lease guarantees will eventually happen.
 *
 * It also rescues rows from the default partition. That is the part worth
 * reading: a row that landed there is not lost, but it is invisible to
 * retention and it defeats pruning, so it must be moved into the month it
 * belongs to rather than merely counted.
 */

import type { PartitionMaintenance } from "@counted/ports";
import { DefaultPartitionTooLarge, requiredPartitions } from "@counted/adapter-postgres";
import type { Handler } from "../runtime";

/**
 * How many months ahead to keep created.
 *
 * Three, not one. The job runs hourly, so one would be enough if nothing ever
 * went wrong — but a worker that has been down for a week must not come back
 * to find ingestion already broken, and two spare months is a week of slack
 * for the price of two empty tables.
 */
export const MONTHS_AHEAD = 3;

/**
 * The largest month this job will move out of the default in one transaction.
 *
 * Not a batch size — a month has to move whole, because a partition cannot be
 * created while any of its rows remain in the default. This is the threshold
 * past which the job refuses and reports instead, rather than holding a
 * transaction over millions of rows unattended.
 */
export const DRAIN_BATCH = 200_000;

export const partitionsEnsure = (maintenance: PartitionMaintenance): Handler => async (_job, context) => {
  // Draining comes first, and the order is not a preference. PostgreSQL
  // refuses to create a partition while the default holds rows belonging to
  // its range — so if the worker has been down long enough for this month's
  // events to land in the default, creating this month's partition fails
  // until they are moved out. Draining does that, and creates whatever months
  // those rows need on the way.
  const stranded = await maintenance.countDefault();
  let drained = 0;
  if (stranded > 0) {
    // Loud. Rows here mean partition creation fell behind at some point, and
    // that is worth knowing even after it has been fixed.
    context.log.warn("partitions.default_occupied", { rows: stranded });
    try {
      drained = await maintenance.drainDefault(DRAIN_BATCH);
    } catch (error) {
      if (error instanceof DefaultPartitionTooLarge) {
        // Retrying will not help: the threshold is a constant and the month
        // will not shrink. Report it as permanent so the job stops burning
        // attempts and an operator sees it in the failed count.
        context.log.error("partitions.default_too_large", {
          month: error.month.toISOString().slice(0, 7),
          rows: error.rows,
          limit: error.limit,
        });
        return { kind: "failed", error: error.message, retryable: false };
      }
      throw error;
    }
  }

  const existing = new Set((await maintenance.list()).map((p) => p.name));
  const required = requiredPartitions(context.now, MONTHS_AHEAD);

  const created: string[] = [];
  for (const spec of required) {
    if (existing.has(spec.name)) continue;
    await maintenance.create(spec);
    created.push(spec.name);
  }

  if (created.length > 0) {
    context.log.info("partitions.created", { partitions: created });
  }

  if (created.length === 0 && drained === 0) {
    return { kind: "noop", detail: "every required partition already exists" };
  }

  return {
    kind: "done",
    detail: `created ${created.length}, drained ${drained}${drained < stranded ? " (more remain)" : ""}`,
  };
};
