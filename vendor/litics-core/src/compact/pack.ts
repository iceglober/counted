/**
 * The pack step: staging rows → one segment row + its summary rows, in the
 * caller's transaction.
 *
 * Reads up to `limit` rows for one tenant in `ts` order with
 * `FOR UPDATE SKIP LOCKED` (two packers on the same tenant never see the same
 * row), packs them, inserts the segment and summaries, deletes exactly those
 * rows by ctid and checks the count. Any mismatch throws so the
 * caller rolls back; nothing is half-packed.
 *
 * A window keeps late arrivals out of recent segments: `late` packs rows
 * whose `ts` is before a boundary, `recent` the rest, so a segment's zone
 * map never spans days because one old event arrived today.
 *
 * The actor hash is `hashtextextended(actor_id::text, 0)` computed by
 * Postgres here and in the read path's tail query, so the two can never
 * disagree.
 */

import type { Pool, PoolClient } from "pg";
import type { ResolvedConfig, ResolvedStream } from "../config.js";
import { LITICS_LOCK_CLASS } from "../locks.js";
import { pack, type PackResult, type StagedRow } from "../segment.js";
import { findStream } from "../engine/scope.js";
import { tsExpr, usExpr } from "../engine/time.js";

export type PackWindow = { kind: "late" | "recent"; boundaryUs: number };

export type PackOptions = {
  /** Required when tenancy is configured. */
  tenant?: string | null;
  /** Rows per segment; defaults to the stream's `segmentRows`. */
  limit?: number;
  /** Stamped on the segment; defaults to the window's kind, else 'recent'. */
  series?: "recent" | "late";
  /** Only rows on one side of a `ts` boundary. Omit for all rows. */
  window?: PackWindow;
};

export type PackOutcome = {
  segmentId: number;
  rows: number;
  tsMinUs: number;
  tsMaxUs: number;
  summaryRows: number;
  series: "recent" | "late";
};

const tenantCast = (cfg: ResolvedConfig): string => (cfg.tenancy!.type === "int8" ? "bigint" : cfg.tenancy!.type);

/** Insert a packed segment and its summary rows. Returns the new segment id. */
export const insertPacked = async (
  client: PoolClient,
  cfg: ResolvedConfig,
  st: ResolvedStream,
  tenant: string | null,
  series: "recent" | "late",
  { segment, summary }: PackResult,
): Promise<number> => {
  const s = cfg.schema;
  const columns = Object.keys(segment.columns);
  const p: unknown[] = [];
  const add = (v: unknown): string => {
    p.push(v);
    return `$${p.length}`;
  };
  const tenantCol = cfg.tenancy ? "tenant_id, " : "";
  const tenantVal = cfg.tenancy ? `${add(tenant)}, ` : "";
  const inserted = await client.query<{ segment_id: string }>(
    `INSERT INTO ${s}.${st.name}_segments (${tenantCol}ts_min, ts_max, n, format, series, raw_bytes, ${columns.join(", ")})
     VALUES (${tenantVal}${tsExpr(add(String(segment.tsMin)))}, ${tsExpr(add(String(segment.tsMax)))}, ${add(segment.n)}, ${add(segment.format)}, ${add(series)}, ${add(JSON.stringify(segment.rawBytes))}::jsonb,
             ${columns.map((c) => `${add(Buffer.from(segment.columns[c]!))}::bytea`).join(", ")})
     RETURNING segment_id`,
    p,
  );
  const segmentId = Number(inserted.rows[0]!.segment_id);

  const measureCols = st.measures.map((m) => m.name);
  const measureRecord = st.measures.map((m) => `${m.name} ${m.type === "int8" ? "text" : "float8"}`);
  const measureSelect = st.measures.map((m) => `, r.${m.name}${m.type === "int8" ? "::bigint" : ""}`).join("");
  const measureJson = (row: { measures: readonly (number | bigint)[] }): Record<string, unknown> =>
    Object.fromEntries(measureCols.map((m, i) => [m, typeof row.measures[i] === "bigint" ? String(row.measures[i]) : row.measures[i]]));
  const sp = (json: string): unknown[] => (cfg.tenancy ? [segmentId, json, tenant] : [segmentId, json]);
  await client.query(
    `INSERT INTO ${s}.${st.name}_summary (segment_id, ${tenantCol}bucket, event_type, n${measureCols.map((m) => `, ${m}`).join("")}, actors)
     SELECT $1::bigint, ${cfg.tenancy ? "$3, " : ""}${tsExpr("r.bucket_us")}, r.event_type, r.n${measureSelect}, r.actors::int8[]
       FROM jsonb_to_recordset($2::jsonb) AS r(${["bucket_us text", "event_type int", "n int", ...measureRecord, "actors text[]"].join(", ")})`,
    sp(JSON.stringify(summary.base.map((row) => ({ bucket_us: String(row.bucket), event_type: row.eventType, n: row.n, ...measureJson(row), actors: row.actors.map(String) })))),
  );
  if (summary.dims.length > 0) {
    await client.query(
      `INSERT INTO ${s}.${st.name}_summary_dims (segment_id, ${tenantCol}bucket, event_type, dim, value, n${measureCols.map((m) => `, ${m}`).join("")}, actors)
       SELECT $1::bigint, ${cfg.tenancy ? "$3, " : ""}${tsExpr("r.bucket_us")}, r.event_type, r.dim, r.value, r.n${measureSelect}, r.actors::int8[]
         FROM jsonb_to_recordset($2::jsonb) AS r(${["bucket_us text", "event_type int", "dim int", "value int", "n int", ...measureRecord, "actors text[]"].join(", ")})`,
      sp(JSON.stringify(summary.dims.map((row) => ({ bucket_us: String(row.bucket), event_type: row.eventType, dim: row.dim, value: row.value, n: row.n, ...measureJson(row), actors: row.actors.map(String) })))),
    );
  }
  return segmentId;
};

export const packOnce = async (
  client: PoolClient,
  cfg: ResolvedConfig,
  streamName: string,
  opts: PackOptions = {},
): Promise<PackOutcome | null> => {
  const st = findStream(cfg, streamName);
  const s = cfg.schema;
  const staging = `${s}.${st.name}`;
  if (cfg.tenancy && (opts.tenant === undefined || opts.tenant === null)) {
    throw new Error("litics: tenancy is configured — packOnce needs a tenant");
  }
  const limit = opts.limit ?? st.segmentRows;
  const params: unknown[] = [limit];
  const where: string[] = [];
  if (cfg.tenancy) {
    params.push(opts.tenant);
    where.push(`s.tenant_id = $${params.length}::${tenantCast(cfg)}`);
  }
  if (opts.window) {
    params.push(String(opts.window.boundaryUs));
    where.push(`s.ts ${opts.window.kind === "late" ? "<" : ">="} ${tsExpr(`$${params.length}`)}`);
  }
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT s.ctid::text AS tid, ${usExpr("s.ts")} AS ts_us,
            s.actor_id::text AS actor, hashtextextended(s.actor_id::text, 0)::text AS actor_hash,
            s.session_id::text AS session_id, s.event_type,
            ${st.dimensions.map((d) => `s.${d.name}, `).join("")}${st.measures.map((m) => `s.${m.name}, `).join("")}s.props::text AS props
       FROM ${staging} s
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.ts
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    params,
  );
  if (rows.length === 0) return null;

  const staged: StagedRow[] = rows.map((r) => ({
    ts: Number(r["ts_us"]),
    actor: st.actorType === "int8" ? BigInt(r["actor"] as string) : (r["actor"] as string),
    actorHash: BigInt(r["actor_hash"] as string),
    sessionId: r["session_id"] === null ? null : BigInt(r["session_id"] as string),
    eventType: r["event_type"] as number,
    dims: Object.fromEntries(st.dimensions.map((d) => [d.name, r[d.name] as number | null])),
    measures: Object.fromEntries(
      st.measures.map((m) => [m.name, r[m.name] === null ? null : m.type === "int8" ? BigInt(r[m.name] as string) : (r[m.name] as number)]),
    ),
    props: r["props"] as string | null,
  }));
  const packed = pack(st, staged);
  const series = opts.series ?? opts.window?.kind ?? "recent";
  const segmentId = await insertPacked(client, cfg, st, opts.tenant ?? null, series, packed);

  // Staging is a plain table, so a ctid is a row's address and `= ANY` is a
  // TID scan: ten thousand lookups, never a scan of the table. (The
  // (tableoid, ctid) row comparison this replaced planned as a sequential
  // scan of the whole table per segment — measured at 230 s for 4M events.)
  const deleted = await client.query(`DELETE FROM ${staging} s WHERE s.ctid = ANY($1::tid[])`, [rows.map((r) => r["tid"])]);
  if (deleted.rowCount !== rows.length) {
    throw new Error(`litics: packed ${rows.length} rows from ${staging} but deleted ${deleted.rowCount}; rolling back`);
  }
  return {
    segmentId,
    rows: rows.length,
    tsMinUs: packed.segment.tsMin,
    tsMaxUs: packed.segment.tsMax,
    summaryRows: packed.summary.base.length + packed.summary.dims.length,
    series,
  };
};

/** Tenants with rows waiting in staging (`[null]` when tenancy is off and rows exist). */
export const stagedTenants = async (client: PoolClient, cfg: ResolvedConfig, streamName: string): Promise<(string | null)[]> => {
  const st = findStream(cfg, streamName);
  if (!cfg.tenancy) {
    const { rows } = await client.query(`SELECT 1 FROM ${cfg.schema}.${st.name} LIMIT 1`);
    return rows.length === 0 ? [] : [null];
  }
  const { rows } = await client.query<{ tenant_id: string }>(`SELECT DISTINCT tenant_id::text FROM ${cfg.schema}.${st.name}`);
  return rows.map((r) => r.tenant_id);
};

/**
 * Pack everything in staging for a stream (or one tenant of it), one
 * transaction per segment, under the per-tenant advisory lock. The last
 * segment is whatever is left, however small — this is "make it current
 * now", for tests and for operators, not the compactor's steady state.
 */
export const flush = async (pool: Pool, cfg: ResolvedConfig, streamName: string, tenant?: string): Promise<PackOutcome[]> => {
  const outcomes: PackOutcome[] = [];
  const client = await pool.connect();
  try {
    const tenants = tenant !== undefined ? [tenant] : await stagedTenants(client, cfg, streamName);
    for (const t of tenants) {
      for (;;) {
        await client.query("BEGIN");
        try {
          await client.query("SELECT pg_advisory_xact_lock($1::int4, hashtext($2))", [LITICS_LOCK_CLASS, t ?? ""]);
          const outcome = await packOnce(client, cfg, streamName, { tenant: t });
          await client.query("COMMIT");
          if (outcome === null) break;
          outcomes.push(outcome);
        } catch (cause) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw cause;
        }
      }
    }
  } finally {
    client.release();
  }
  return outcomes;
};
