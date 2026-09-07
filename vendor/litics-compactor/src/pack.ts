/**
 * The pack job: for every stream and every tenant with rows in staging,
 * pack full segments while there are enough rows, and a partial one when
 * the oldest staged row has waited long enough. Late arrivals (ts before
 * `now − lateAfterMs`) go into segments of their own.
 *
 * Per tenant, per segment: one transaction, one `pg_try_advisory_xact_lock`
 * on the tenant. Busy means another compactor has it; skip and say so.
 */

import { LITICS_LOCK_CLASS, packOnce, SegmentTooLargeError, stagedTenants, type ResolvedConfig, type ResolvedStream } from "@litics/core";
import type { Pool } from "pg";
import { describeError, type Logger } from "./logger.js";

export type PackPolicy = {
  /** A partial segment is packed once the oldest staged row is this old. */
  maxStagingAgeMs: number;
  /** Rows with `ts` older than this go into the 'late' series. */
  lateAfterMs: number;
  /** Segments packed per tenant per run, at most; a burst continues next tick. */
  maxSegmentsPerTenant?: number;
};

export type PackReport = {
  segments: number;
  rows: number;
  tenants: number;
  /** Tenants another compactor held the lock for. */
  busy: number;
  errors: number;
};

const tsExprOf = (param: string): string => `('epoch'::timestamptz + ${param}::int8 * interval '1 microsecond')`;

export const packStream = async (
  pool: Pool,
  cfg: ResolvedConfig,
  st: ResolvedStream,
  policy: PackPolicy,
  nowMs: number,
  logger: Logger,
): Promise<PackReport> => {
  const report: PackReport = { segments: 0, rows: 0, tenants: 0, busy: 0, errors: 0 };
  const staging = `${cfg.schema}.${st.name}`;
  const boundaryUs = (nowMs - policy.lateAfterMs) * 1000;
  const client = await pool.connect();
  try {
    const tenants = await stagedTenants(client, cfg, st.name);
    for (const tenant of tenants) {
      report.tenants++;
      const tenantWhere = cfg.tenancy ? "WHERE tenant_id = $2" : "";
      const params = (extra: unknown[] = []): unknown[] => (cfg.tenancy ? [...extra, tenant] : extra);
      let packed = 0;
      let limit = st.segmentRows;
      const cap = policy.maxSegmentsPerTenant ?? 1000;
      while (packed < cap) {
        await client.query("BEGIN");
        try {
          const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock($1::int4, hashtext($2)) AS ok", [
            LITICS_LOCK_CLASS,
            tenant ?? "",
          ]);
          if (!lock.rows[0]!.ok) {
            await client.query("ROLLBACK");
            report.busy++;
            break;
          }
          // The oldest row's age is measured by the database's clock against
          // its own `staged_at`, never against this process's clock: the two
          // machines disagree by seconds routinely, and a skew the wrong way
          // would make every row look like it arrived in the future.
          const { rows } = await client.query<{ late: number; recent: number; waited_ms: string | null }>(
            `SELECT count(*) FILTER (WHERE ts < ${tsExprOf("$1")})::int AS late,
                    count(*) FILTER (WHERE ts >= ${tsExprOf("$1")})::int AS recent,
                    (extract(epoch from (now() - min(staged_at))) * 1000)::int8::text AS waited_ms
               FROM ${staging} ${tenantWhere}`,
            params([String(boundaryUs)]),
          );
          const { late, recent, waited_ms } = rows[0]!;
          const waited = waited_ms === null ? 0 : Math.max(0, Number(waited_ms));
          const overdue = waited >= policy.maxStagingAgeMs;
          const window =
            late > 0 && (late >= st.segmentRows || overdue)
              ? ({ kind: "late", boundaryUs } as const)
              : recent >= st.segmentRows || (recent > 0 && overdue)
                ? ({ kind: "recent", boundaryUs } as const)
                : null;
          if (window === null) {
            await client.query("ROLLBACK");
            break;
          }
          const outcome = await packOnce(client, cfg, st.name, { tenant, window, limit });
          await client.query("COMMIT");
          if (outcome === null) break;
          packed++;
          report.segments++;
          report.rows += outcome.rows;
          limit = st.segmentRows;
          logger.info("pack.segment", { stream: st.name, tenant, segmentId: outcome.segmentId, rows: outcome.rows, series: outcome.series });
        } catch (cause) {
          await client.query("ROLLBACK").catch(() => undefined);
          if (cause instanceof SegmentTooLargeError && limit > 100) {
            // One batch with enormous property bags: pack fewer rows at a
            // time until it fits, then go back to the configured size.
            limit = Math.max(100, Math.floor(limit / 2));
            logger.warn("pack.split", { stream: st.name, tenant, limit, detail: cause.message });
            continue;
          }
          report.errors++;
          logger.error("pack.failed", { stream: st.name, tenant, detail: describeError(cause) });
          break;
        }
      }
    }
  } finally {
    client.release();
  }
  return report;
};

export const packAll = async (pool: Pool, cfg: ResolvedConfig, policy: PackPolicy, nowMs: number, logger: Logger): Promise<PackReport> => {
  const total: PackReport = { segments: 0, rows: 0, tenants: 0, busy: 0, errors: 0 };
  for (const st of cfg.streams) {
    const r = await packStream(pool, cfg, st, policy, nowMs, logger);
    total.segments += r.segments;
    total.rows += r.rows;
    total.tenants += r.tenants;
    total.busy += r.busy;
    total.errors += r.errors;
  }
  return total;
};
