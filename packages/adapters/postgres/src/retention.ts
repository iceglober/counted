/**
 * Deleting events past their retention.
 *
 * `DROP TABLE` on an expired partition is the cheap path: O(1), no vacuum, no
 * lock on live data. It is also irreversible, which is why the decision about
 * *which* partitions have expired lives in the domain and this file only obeys.
 *
 * The row-level purge exists because partitions are global and retention is
 * not. A free workspace's events between six months and two years sit inside
 * partitions a paying customer still needs, so they have to be deleted by
 * project rather than by dropping the month.
 */

import type { Pool } from "pg";
import { Instant, ProjectId } from "@counted/domain";
import type { ProjectRetention, RetentionMaintenance } from "@counted/ports";
import { EVENTS_TABLE } from "./sql/schema";

export const createRetentionMaintenance = (pool: Pool): RetentionMaintenance => ({
  async dropPartition(name: string): Promise<void> {
    // Not parameterised because an identifier cannot be. The name comes from
    // `parsePartitionName`, which only accepts `events_YYYY_MM` — nothing a
    // caller supplies reaches here.
    if (!/^events_\d{4}_\d{2}$/.test(name)) {
      throw new Error(`refusing to drop ${name}: not a month partition`);
    }
    await pool.query(`DROP TABLE IF EXISTS ${name}`);
  },

  async projectsWithPlans(): Promise<readonly ProjectRetention[]> {
    const { rows } = await pool.query<{ id: string; plan: string | null; payment_state: string | null }>(
      `SELECT p.id, w.plan, w.payment_state
         FROM projects p
         LEFT JOIN workspaces w ON w.id = p.workspace_id
        ORDER BY p.id`,
    );
    return rows.map((row) => ({
      project: ProjectId(row.id),
      // An unclaimed project has no workspace, so it gets the free plan's
      // retention — the same allowance it gets for ingestion.
      plan: row.plan ?? "free",
      payment: row.payment_state ?? "none",
    }));
  },

  /**
   * Delete a bounded slice of one project's expired events.
   *
   * Bounded by the dedup key, **not by ctid**. A ctid is unique within a
   * single table and a partitioned table is many tables: each partition has
   * its own ctid space, so `WHERE ctid IN (SELECT ctid …)` across the parent
   * matches rows in *other* partitions that happen to share a physical
   * address. The first version of this deleted a 2026 row while purging
   * everything before 2025, which a live test caught and no amount of reading
   * would have.
   *
   * `(project_id, idempotency_key, occurred_at)` is the events_dedup unique
   * constraint, so this identifies exactly one row and uses an index to do it.
   */
  async purgeProject(project: ProjectId, olderThan: Instant, limit: number): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM ${EVENTS_TABLE}
        WHERE (project_id, idempotency_key, occurred_at) IN (
          SELECT project_id, idempotency_key, occurred_at FROM ${EVENTS_TABLE}
           WHERE project_id = $1 AND occurred_at < $2
           ORDER BY occurred_at
           LIMIT $3
        )`,
      [project, Instant.toDate(olderThan), limit],
    );
    return rowCount ?? 0;
  },
});
