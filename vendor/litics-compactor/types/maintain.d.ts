/**
 * Maintenance: merge runs of small segments, apply retention, vacuum
 * staging. Every write is a new row plus a delete; nothing is edited.
 */
import { type ResolvedConfig, type ResolvedStream } from "@litics/core";
import type { Pool } from "pg";
import { type Logger } from "./logger.js";
export type MaintainReport = {
    merges: number;
    mergedSegments: number;
    retentionDeleted: number;
    busy: number;
    errors: number;
};
type Small = {
    segmentId: number;
    n: number;
    series: "recent" | "late";
    tsMinUs: number;
    tsMaxUs: number;
};
/** A merged segment never spans more than this: a quiet tenant's hours become days, not months. */
export declare const MAX_MERGE_SPAN_US: number;
/**
 * Consecutive same-series small segments whose rows fit in one segment and
 * whose combined time span stays within MAX_MERGE_SPAN_US. The span limit
 * is what keeps the zone map honest: a segment covering a week would be
 * opened by every read of that week.
 */
export declare const runsOf: (small: Small[], segmentRows: number, maxSpanUs?: number) => Small[][];
export declare const mergeStream: (pool: Pool, cfg: ResolvedConfig, st: ResolvedStream, logger: Logger) => Promise<MaintainReport>;
/** Delete whole segments whose newest event is older than the stream's retention. Batched, autocommit. */
export declare const applyRetention: (pool: Pool, cfg: ResolvedConfig, st: ResolvedStream) => Promise<number>;
/** VACUUM cannot run inside a transaction; `pool.query` is autocommit. */
export declare const vacuumStaging: (pool: Pool, cfg: ResolvedConfig, st: ResolvedStream) => Promise<void>;
export declare const maintainAll: (pool: Pool, cfg: ResolvedConfig, logger: Logger) => Promise<MaintainReport>;
export {};
