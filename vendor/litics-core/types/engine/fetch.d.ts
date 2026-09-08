/**
 * Reading segments out of Postgres: the zone-map select, then a server-side
 * cursor over the byteas of the segments that are not already decoded.
 *
 * Pull-based on purpose. `FETCH n` hands over a few segments, they are
 * decoded, the next few are fetched — memory is bounded by the batch, not
 * by the window, and an abort between batches destroys the connection
 * rather than draining a result nobody wants.
 */
import type { PoolClient } from "pg";
import type { ResolvedConfig, ResolvedStream } from "../config.js";
import { type DecodedSegment } from "../segment.js";
import { SegmentCache } from "./cache.js";
import type { Window } from "./plan.js";
export declare class AbortError extends Error {
    constructor();
}
export declare const throwIfAborted: (signal: AbortSignal | undefined) => void;
export type ZoneEntry = {
    segmentId: number;
    format: number;
    n: number;
    tsMinUs: number;
    tsMaxUs: number;
};
/** Segments whose [ts_min, ts_max] touches any of `windows`, in the query's scope. */
export declare const zoneMap: (client: PoolClient, cfg: ResolvedConfig, stream: ResolvedStream, windows: readonly Window[], scope: {
    sql: string;
    params: unknown[];
}) => Promise<ZoneEntry[]>;
export type FetchStats = {
    segments: number;
    fetched: number;
    cacheHits: number;
};
/**
 * Yield each segment in `zone` decoded to (at least) `columns`. Cached
 * columns are reused; the rest come through a cursor in batches of `batch`.
 */
export declare function decodedSegments(client: PoolClient, cfg: ResolvedConfig, stream: ResolvedStream, zone: readonly ZoneEntry[], columns: readonly string[], cache: SegmentCache, signal: AbortSignal | undefined, stats: FetchStats, batch?: number): AsyncGenerator<{
    entry: ZoneEntry;
    decoded: DecodedSegment;
}>;
