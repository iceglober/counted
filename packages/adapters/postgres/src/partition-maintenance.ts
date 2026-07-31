/**
 * Reading and changing the event table's partitions.
 *
 * Two jobs. Creating next month's partition before it is needed, and rescuing
 * anything that landed in the default because creation once fell behind.
 *
 * The rescue matters more than it looks. A row in the default partition is not
 * lost, but it is invisible to retention — `DROP TABLE` on a month never
 * touches it — and it defeats partition pruning, so every query that should
 * scan one month scans it too. Left alone it accumulates silently forever.
 */

import type { Pool } from "pg";
import { Instant } from "@counted/domain";
import type { PartitionMaintenance, PartitionSpec } from "@counted/ports";
import { EVENTS_TABLE } from "./sql/schema";
import { createPartitionSql, parsePartitionName, partitionFor } from "./partitions";

export const DEFAULT_PARTITION = `${EVENTS_TABLE}_default`;

/**
 * A month stranded in the default with more rows than one transaction should
 * move. Named rather than a bare Error so the job can report it precisely
 * instead of retrying forever against a threshold that will not change.
 */
export class DefaultPartitionTooLarge extends Error {
  constructor(
    readonly month: Date,
    readonly rows: number,
    readonly limit: number,
  ) {
    super(`${rows} rows for ${month.toISOString().slice(0, 7)} exceed the ${limit}-row drain threshold`);
    this.name = "DefaultPartitionTooLarge";
  }
}

export const createPartitionMaintenance = (pool: Pool): PartitionMaintenance => ({
  async list(): Promise<readonly PartitionSpec[]> {
    // Asked of the catalog rather than remembered, so a partition created by
    // hand — or missing because someone dropped it — is seen as it really is.
    const { rows } = await pool.query<{ child: string }>(
      `SELECT c.relname AS child
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = $1
        ORDER BY c.relname`,
      [EVENTS_TABLE],
    );
    // `parsePartitionName` returns null for the default partition and for
    // anything that is not one of ours.
    return rows
      .map((r) => parsePartitionName(r.child))
      .filter((spec): spec is PartitionSpec => spec !== null);
  },

  async create(spec: PartitionSpec): Promise<void> {
    // IF NOT EXISTS, so two workers racing on the same month is a no-op rather
    // than an error one of them has to interpret.
    await pool.query(createPartitionSql(spec));
  },

  async countDefault(): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ONLY ${DEFAULT_PARTITION}`);
    return Number(rows[0]?.n ?? 0);
  },

  /**
   * Move one month's rows out of the default partition and into their own.
   *
   * The shape of this is forced by PostgreSQL, and the constraint is worth
   * stating plainly: **a partition cannot be created while the default holds
   * any row belonging to its range.** Attaching a child scans the default and
   * refuses if a single row would land in it. That rule is what stops a row
   * existing in two partitions, and it has a consequence — a *partial* drain
   * of a month can never finish. Move half of March out, and creating March's
   * partition still fails on the half left behind.
   *
   * So the unit is a month, not a row count, and it is all-or-nothing: delete
   * every row of the oldest month present, create that month, insert them
   * back. One transaction, so a crash leaves them in the default to be drained
   * again rather than lost between steps.
   *
   * `limit` is a safety threshold rather than a batch size. A month bigger
   * than it is refused and reported instead of being attempted — holding ten
   * million rows in one transaction is not a thing to do silently at three in
   * the morning.
   */
  async drainDefault(limit: number): Promise<number> {
    const { rows: months } = await pool.query<{ month: Date; n: string }>(
      `SELECT date_trunc('month', occurred_at) AS month, count(*)::text AS n
         FROM ONLY ${DEFAULT_PARTITION}
        GROUP BY 1
        ORDER BY 1
        LIMIT 1`,
    );
    const oldest = months[0];
    if (oldest === undefined) return 0;

    if (Number(oldest.n) > limit) {
      // Reported, not attempted. The caller logs it; an operator can raise the
      // threshold deliberately or do it in a maintenance window.
      throw new DefaultPartitionTooLarge(oldest.month, Number(oldest.n), limit);
    }

    const spec = partitionFor(Instant.fromEpochMillis(oldest.month.getTime()));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query<Record<string, unknown>>(
        `DELETE FROM ONLY ${DEFAULT_PARTITION}
          WHERE occurred_at >= $1 AND occurred_at < $2
          RETURNING *`,
        [Instant.toDate(spec.from), Instant.toDate(spec.to)],
      );
      if (rows.length === 0) {
        await client.query("COMMIT");
        return 0;
      }

      // Legal now: the default no longer holds anything in this range.
      await client.query(createPartitionSql(spec));

      const columns = Object.keys(rows[0]!);
      const values: unknown[] = [];
      const tuples = rows.map((row) => {
        const start = values.length;
        for (const column of columns) values.push(row[column]);
        return `(${columns.map((_, i) => `$${start + i + 1}`).join(", ")})`;
      });

      // Back through the parent, so each row is routed by its own timestamp.
      await client.query(
        `INSERT INTO ${EVENTS_TABLE} (${columns.join(", ")}) VALUES ${tuples.join(", ")}
         ON CONFLICT ON CONSTRAINT events_dedup DO NOTHING`,
        values,
      );

      await client.query("COMMIT");
      return rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
});

/** The months that should exist: this one, plus `ahead` more. */
export const requiredPartitions = (at: Instant, ahead: number): readonly PartitionSpec[] => {
  const out: PartitionSpec[] = [partitionFor(at)];
  let cursor = out[0]!.from;
  for (let i = 0; i < ahead; i++) {
    // Step from the partition's own upper bound, so the arithmetic is the
    // domain's calendar rather than "add thirty days".
    cursor = out[out.length - 1]!.to;
    out.push(partitionFor(cursor));
  }
  return out;
};
