/**
 * Maintenance: merge runs of small segments, apply retention, vacuum
 * staging. Every write is a new row plus a delete; nothing is edited.
 */

import {
  decode,
  insertPacked,
  LITICS_LOCK_CLASS,
  pack,
  rowsOf,
  segmentColumns,
  type ResolvedConfig,
  type ResolvedStream,
  type Segment,
} from "@litics/core";
import type { Pool, PoolClient } from "pg";
import { describeError, type Logger } from "./logger.js";

export type MaintainReport = {
  merges: number;
  mergedSegments: number;
  retentionDeleted: number;
  busy: number;
  errors: number;
};

type Small = { segmentId: number; n: number; series: "recent" | "late"; tsMinUs: number; tsMaxUs: number };

/** A merged segment never spans more than this: a quiet tenant's hours become days, not months. */
export const MAX_MERGE_SPAN_US = 24 * 3_600_000_000;

/**
 * Consecutive same-series small segments whose rows fit in one segment and
 * whose combined time span stays within MAX_MERGE_SPAN_US. The span limit
 * is what keeps the zone map honest: a segment covering a week would be
 * opened by every read of that week.
 */
export const runsOf = (small: Small[], segmentRows: number, maxSpanUs = MAX_MERGE_SPAN_US): Small[][] => {
  const runs: Small[][] = [];
  let run: Small[] = [];
  let total = 0;
  const close = (): void => {
    if (run.length >= 2) runs.push(run);
    run = [];
    total = 0;
  };
  for (const s of small) {
    if (
      run.length > 0 &&
      (run[0]!.series !== s.series || total + s.n > segmentRows || s.tsMaxUs - run[0]!.tsMinUs > maxSpanUs)
    ) {
      close();
    }
    run.push(s);
    total += s.n;
  }
  close();
  return runs;
};

const mergeRun = async (client: PoolClient, cfg: ResolvedConfig, st: ResolvedStream, tenant: string | null, run: Small[]): Promise<boolean> => {
  const segments = `${cfg.schema}.${st.name}_segments`;
  const ids = run.map((s) => s.segmentId);
  const columns = segmentColumns(st);
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT segment_id, format, n, raw_bytes,
            (extract(epoch from ts_min) * 1000000)::int8::text AS ts_min_us,
            (extract(epoch from ts_max) * 1000000)::int8::text AS ts_max_us,
            ${columns.join(", ")}
       FROM ${segments} WHERE segment_id = ANY($1::int8[]) ORDER BY ts_min FOR UPDATE`,
    [ids.map(String)],
  );
  // Another compactor got here first: some of the run is gone. Leave it.
  if (rows.length !== ids.length) return false;
  const all = rows.flatMap((row) => {
    const packed: Record<string, Uint8Array> = {};
    for (const c of columns) packed[c] = row[c] as Uint8Array;
    const segment: Segment = {
      format: row["format"] as number,
      tsMin: Number(row["ts_min_us"]),
      tsMax: Number(row["ts_max_us"]),
      n: row["n"] as number,
      columns: packed,
      rawBytes: row["raw_bytes"] as Record<string, number>,
    };
    return rowsOf(st, decode(st, segment));
  });
  await insertPacked(client, cfg, st, tenant, run[0]!.series, pack(st, all));
  const deleted = await client.query(`DELETE FROM ${segments} WHERE segment_id = ANY($1::int8[])`, [ids.map(String)]);
  if (deleted.rowCount !== ids.length) throw new Error(`litics: merge deleted ${deleted.rowCount} of ${ids.length} segments`);
  return true;
};

export const mergeStream = async (pool: Pool, cfg: ResolvedConfig, st: ResolvedStream, logger: Logger): Promise<MaintainReport> => {
  const report: MaintainReport = { merges: 0, mergedSegments: 0, retentionDeleted: 0, busy: 0, errors: 0 };
  const segments = `${cfg.schema}.${st.name}_segments`;
  const client = await pool.connect();
  try {
    const tenants = cfg.tenancy
      ? (await client.query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id::text FROM ${segments} WHERE n < $1`, [st.segmentRows / 2])).rows.map((r) => r.tenant_id)
      : [null];
    for (const tenant of tenants) {
      const { rows: small } = await client.query<{ segment_id: string; n: number; series: "recent" | "late"; ts_min_us: string; ts_max_us: string }>(
        `SELECT segment_id::text, n, series,
                (extract(epoch from ts_min) * 1000000)::int8::text AS ts_min_us,
                (extract(epoch from ts_max) * 1000000)::int8::text AS ts_max_us
           FROM ${segments}
          WHERE n < $1${cfg.tenancy ? " AND tenant_id = $2" : ""}
          ORDER BY series, ts_min`,
        cfg.tenancy ? [st.segmentRows / 2, tenant] : [st.segmentRows / 2],
      );
      const runs = runsOf(
        small.map((r) => ({ segmentId: Number(r.segment_id), n: r.n, series: r.series, tsMinUs: Number(r.ts_min_us), tsMaxUs: Number(r.ts_max_us) })),
        st.segmentRows,
      );
      for (const run of runs) {
        await client.query("BEGIN");
        try {
          const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock($1::int4, hashtext($2)) AS ok", [LITICS_LOCK_CLASS, tenant ?? ""]);
          if (!lock.rows[0]!.ok) {
            await client.query("ROLLBACK");
            report.busy++;
            break;
          }
          const merged = await mergeRun(client, cfg, st, tenant, run);
          await client.query("COMMIT");
          if (merged) {
            report.merges++;
            report.mergedSegments += run.length;
            logger.info("merge.run", { stream: st.name, tenant, segments: run.length, rows: run.reduce((a, s) => a + s.n, 0) });
          }
        } catch (cause) {
          await client.query("ROLLBACK").catch(() => undefined);
          report.errors++;
          logger.error("merge.failed", { stream: st.name, tenant, detail: describeError(cause) });
        }
      }
    }
  } finally {
    client.release();
  }
  return report;
};

/** Delete whole segments whose newest event is older than the stream's retention. Batched, autocommit. */
export const applyRetention = async (pool: Pool, cfg: ResolvedConfig, st: ResolvedStream): Promise<number> => {
  const segments = `${cfg.schema}.${st.name}_segments`;
  let total = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM ${segments} WHERE segment_id IN (
         SELECT segment_id FROM ${segments} WHERE ts_max < now() - $1::interval ORDER BY segment_id LIMIT 200)`,
      [st.retention],
    );
    total += rowCount ?? 0;
    if (!rowCount) break;
  }
  return total;
};

/** VACUUM cannot run inside a transaction; `pool.query` is autocommit. */
export const vacuumStaging = async (pool: Pool, cfg: ResolvedConfig, st: ResolvedStream): Promise<void> => {
  await pool.query(`VACUUM (ANALYZE) ${cfg.schema}.${st.name}`);
};

export const maintainAll = async (pool: Pool, cfg: ResolvedConfig, logger: Logger): Promise<MaintainReport> => {
  const total: MaintainReport = { merges: 0, mergedSegments: 0, retentionDeleted: 0, busy: 0, errors: 0 };
  for (const st of cfg.streams) {
    // Retention first, so an expired segment is never merged into a live one.
    try {
      total.retentionDeleted += await applyRetention(pool, cfg, st);
    } catch (cause) {
      total.errors++;
      logger.error("retention.failed", { stream: st.name, detail: describeError(cause) });
    }
    const m = await mergeStream(pool, cfg, st, logger);
    total.merges += m.merges;
    total.mergedSegments += m.mergedSegments;
    total.busy += m.busy;
    total.errors += m.errors;
    try {
      await vacuumStaging(pool, cfg, st);
    } catch (cause) {
      total.errors++;
      logger.error("vacuum.failed", { stream: st.name, detail: describeError(cause) });
    }
  }
  return total;
};
