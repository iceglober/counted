/**
 * The pack job: for every stream and every tenant with rows in staging,
 * pack full segments while there are enough rows, and a partial one when
 * the oldest staged row has waited long enough. Late arrivals (ts before
 * `now − lateAfterMs`) go into segments of their own.
 *
 * Per tenant, per segment: one transaction, one `pg_try_advisory_xact_lock`
 * on the tenant. Busy means another compactor has it; skip and say so.
 */
import { type ResolvedConfig, type ResolvedStream } from "@litics/core";
import type { Pool } from "pg";
import { type Logger } from "./logger.js";
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
export declare const packStream: (pool: Pool, cfg: ResolvedConfig, st: ResolvedStream, policy: PackPolicy, nowMs: number, logger: Logger) => Promise<PackReport>;
export declare const packAll: (pool: Pool, cfg: ResolvedConfig, policy: PackPolicy, nowMs: number, logger: Logger) => Promise<PackReport>;
