/**
 * Daily rollups, and how they stay true.
 *
 * The refresh is one statement: find every `(project, day)` touched by events
 * ingested since the watermark, recompute those buckets from scratch, upsert.
 *
 * Two decisions carry the correctness:
 *
 *   **Recompute, never increment.** An incremental counter drifts the first
 *   time a refresh runs twice, and the worker's lease guarantees that
 *   eventually happens. Recomputing a whole bucket makes a second run a no-op.
 *
 *   **Dirty by `ingested_at`, not by "recent days".** The ingest contract
 *   accepts events backdated up to ninety days, so a bucket from March can
 *   change in June. A trailing-window refresh would miss that silently; this
 *   dirties the bucket the event *belongs to*, whenever it happened to arrive.
 *
 * The window is bounded on ingestion time rather than by a row limit, so the
 * watermark can advance to a known point even when the batch is large.
 */

import type { Pool } from "pg";
import { Instant, ProjectId } from "@counted/domain";
import type { RollupMaintenance, RollupRow } from "@counted/ports";

const STATE_ID = "daily";

export const createRollupMaintenance = (pool: Pool): RollupMaintenance => ({
  async watermark(): Promise<Instant | null> {
    const { rows } = await pool.query<{ watermark: Date }>(`SELECT watermark FROM rollup_state WHERE id = $1`, [
      STATE_ID,
    ]);
    const row = rows[0];
    return row === undefined ? null : Instant.fromEpochMillis(row.watermark.getTime());
  },

  async refresh(from: Instant | null, to: Instant): Promise<number> {
    // `from` null means "everything so far" — the first run, or a rebuild.
    const lower = from === null ? new Date(0) : Instant.toDate(from);

    const { rowCount } = await pool.query(
      `WITH dirty AS (
         SELECT DISTINCT project_id, (occurred_at AT TIME ZONE 'UTC')::date AS day
           FROM events
          WHERE ingested_at > $1 AND ingested_at <= $2
       ),
       recomputed AS (
         SELECT e.project_id,
                (e.occurred_at AT TIME ZONE 'UTC')::date AS day,
                e.name,
                count(*)                          AS events,
                count(DISTINCT e.visit_id)        AS visits,
                count(DISTINCT e.person_id)       AS people
           FROM events e
           JOIN dirty d
             ON d.project_id = e.project_id
            AND d.day = (e.occurred_at AT TIME ZONE 'UTC')::date
          GROUP BY 1, 2, 3
       )
       INSERT INTO rollup_daily (project_id, day, name, events, visits, people, refreshed_at)
       SELECT project_id, day, name, events, visits, people, $3 FROM recomputed
       ON CONFLICT (project_id, day, name) DO UPDATE SET
         events = EXCLUDED.events,
         visits = EXCLUDED.visits,
         people = EXCLUDED.people,
         refreshed_at = EXCLUDED.refreshed_at`,
      [lower, Instant.toDate(to), Instant.toDate(to)],
    );

    // Buckets that lost every row — a retention purge, or a project deleted —
    // must go, or the rollup keeps reporting counts for data that is gone.
    await pool.query(
      `DELETE FROM rollup_daily r
        WHERE r.refreshed_at < $1
          AND NOT EXISTS (
            SELECT 1 FROM events e
             WHERE e.project_id = r.project_id
               AND (e.occurred_at AT TIME ZONE 'UTC')::date = r.day
               AND e.name = r.name
          )`,
      [Instant.toDate(to)],
    );

    return rowCount ?? 0;
  },

  async commitWatermark(to: Instant): Promise<void> {
    await pool.query(
      `INSERT INTO rollup_state (id, watermark) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET watermark = EXCLUDED.watermark`,
      [STATE_ID, Instant.toDate(to)],
    );
  },

  async dailyCounts(project: ProjectId, from: Instant, to: Instant): Promise<readonly RollupRow[]> {
    const { rows } = await pool.query<{ day: Date; name: string; events: string; visits: string; people: string }>(
      `SELECT day, name, events::text, visits::text, people::text
         FROM rollup_daily
        WHERE project_id = $1
          AND day >= ($2::timestamptz AT TIME ZONE 'UTC')::date
          AND day <= ($3::timestamptz AT TIME ZONE 'UTC')::date
        ORDER BY day, name`,
      [project, Instant.toDate(from), Instant.toDate(to)],
    );
    return rows.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      name: row.name,
      events: Number(row.events),
      visits: Number(row.visits),
      people: Number(row.people),
    }));
  },
});
