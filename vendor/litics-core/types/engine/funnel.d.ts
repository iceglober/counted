/**
 * Three-step funnels, computed in the application.
 *
 * Gzip hides the columns from SQL, so the actor-ordered index the old raw
 * table had is rebuilt in memory: fetch `ts`, `event_type` and `actor` from
 * every segment overlapping the window plus the staging tail, keep only the
 * three step types, sort by (actor hash, ts), and walk each actor's events
 * once. The semantics are the old three-CTE query's exactly: step 1 is the
 * actor's first step-1 event in the window; step 2 the first step-2 event
 * strictly after it and before `least(to, t1 + within)`; step 3 likewise
 * after step 2.
 */
import type { PoolClient } from "pg";
import { type ResolvedConfig } from "../config.js";
import { SegmentCache } from "./cache.js";
import { type FetchStats } from "./fetch.js";
import type { QueryOptions } from "./range.js";
export type FunnelQuery = {
    from: Date | string;
    to: Date | string;
    /** Max time from step 1 to completion. Default '7 days'. */
    within?: string;
    scope?: string | number | bigint;
};
export type FunnelResult = {
    step1: number;
    step2: number;
    step3: number;
};
export type FunnelOptions = QueryOptions & {
    /** Refuse rather than hold more step events than this in memory. Default 5,000,000. */
    maxEvents?: number;
};
export declare const runFunnel: (cfg: ResolvedConfig, pool: {
    connect(): Promise<PoolClient>;
}, cache: SegmentCache, streamName: string, steps: readonly string[], q: FunnelQuery, opts: FunnelOptions, onStats?: (stats: FetchStats & {
    events: number;
}) => void) => Promise<FunnelResult>;
