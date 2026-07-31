/**
 * Monthly partition management.
 *
 * Bounds are computed with the domain's own calendar arithmetic — `truncTo`
 * and `step` from the time axis — rather than a second implementation here.
 * That is the same reuse the whole rewrite turns on: partition boundaries and
 * chart bucket boundaries are the same notion of "a month", so they cannot
 * drift apart.
 *
 * Retention is `DROP TABLE` on a whole partition. It is O(1), takes no vacuum,
 * and holds no lock on live data — which is why the pricing page's 6mo/24mo
 * claim becomes cheap to honour instead of needing a delete job that would
 * churn the table forever.
 */

import { Instant, step, truncTo } from "@counted/domain";
import type { PartitionSpec } from "@counted/ports";
import { EVENTS_TABLE } from "./sql/schema";

/** Re-exported from the port so there is one definition, not two. */
export type { PartitionSpec } from "@counted/ports";

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** The partition an instant belongs to. */
export const partitionFor = (at: Instant): PartitionSpec => {
  const from = truncTo("month", at);
  const to = step("month", from);
  const d = new Date(Instant.toEpochMillis(from));
  return {
    name: `${EVENTS_TABLE}_${d.getUTCFullYear()}_${pad(d.getUTCMonth() + 1)}`,
    from,
    to,
  };
};

/**
 * Every partition needed to cover `[from, to]`, plus `ahead` further months so
 * ingestion never races partition creation. Running out is how a system starts
 * writing everything into the default partition and quietly loses its
 * pruning.
 */
export const partitionsCovering = (
  from: Instant,
  to: Instant,
  ahead = 2,
): readonly PartitionSpec[] => {
  const out: PartitionSpec[] = [];
  let cursor = truncTo("month", from);
  const end = truncTo("month", to);

  // Guard against a pathological range rather than looping forever.
  for (let i = 0; i < 600; i++) {
    out.push(partitionFor(cursor));
    if (cursor >= end) break;
    cursor = step("month", cursor);
  }
  for (let i = 0; i < ahead; i++) {
    cursor = step("month", cursor);
    out.push(partitionFor(cursor));
  }
  return out;
};

/** ISO-8601, which Postgres accepts for a timestamptz bound. */
const bound = (i: Instant): string => Instant.toISO(i);

export const createPartitionSql = (spec: PartitionSpec): string =>
  `CREATE TABLE IF NOT EXISTS ${spec.name} PARTITION OF ${EVENTS_TABLE} ` +
  `FOR VALUES FROM ('${bound(spec.from)}') TO ('${bound(spec.to)}');`;

export const dropPartitionSql = (spec: PartitionSpec): string =>
  `DROP TABLE IF EXISTS ${spec.name};`;

/**
 * Which partitions hold nothing but data older than the cut-off.
 *
 * A partition is only droppable when its *entire* range is past retention.
 * Dropping the one containing the cut-off would delete data the customer is
 * still entitled to — the kind of off-by-one that is unrecoverable.
 */
export const expiredPartitions = (
  existing: readonly PartitionSpec[],
  olderThan: Instant,
): readonly PartitionSpec[] => existing.filter((p) => p.to <= olderThan);

/**
 * Parse a partition name back into its bounds, for reconciling against what
 * the database actually has. Returns null for anything that is not one of
 * ours — the default partition, or a table someone else made.
 */
export const parsePartitionName = (name: string): PartitionSpec | null => {
  const match = new RegExp(`^${EVENTS_TABLE}_(\\d{4})_(\\d{2})$`).exec(name);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  const from = Instant.fromEpochMillis(Date.UTC(year, month - 1, 1));
  return { name, from, to: step("month", from) };
};
