/**
 * The read engine: hand it the resolved config and a pool, ask it questions.
 *
 *   const engine = createEngine(cfg, { pool });
 *   await engine.counts("events", { from, to, step: "1 hour", scope: org });
 *
 * Every call is one REPEATABLE READ snapshot over summaries, segments and
 * the staging tail. Decoded segments are cached across calls up to
 * `cache.maxBytes` (default 256 MiB).
 */
import type { PoolClient } from "pg";
import type { ResolvedConfig } from "../config.js";
import { SegmentCache } from "./cache.js";
import { type FunnelOptions, type FunnelQuery, type FunnelResult } from "./funnel.js";
import { type ReadPlan } from "./plan.js";
import { type QueryOptions, type RangeQuery, type RangeRow, type ReadStats } from "./range.js";
export type { FunnelOptions, FunnelQuery, FunnelResult, QueryOptions, RangeQuery, RangeRow, ReadPlan, ReadStats };
export { AbortError } from "./fetch.js";
export { planRange } from "./plan.js";
export { dimOrdinal } from "./scope.js";
export { SegmentCache } from "./cache.js";
export { fromMicros, HOUR_US, toMicros } from "./time.js";
export type EngineOptions = {
    pool: {
        connect(): Promise<PoolClient>;
    };
    cache?: {
        maxBytes?: number;
    } | SegmentCache;
    /** Called after every range read with what it touched. For logging. */
    onRead?: (stream: string, stats: ReadStats) => void;
};
export type Engine = {
    counts(stream: string, q: RangeQuery, opts?: QueryOptions): Promise<RangeRow[]>;
    uniques(stream: string, q: RangeQuery, opts?: QueryOptions): Promise<RangeRow[]>;
    sums(stream: string, measure: string, q: RangeQuery, opts?: QueryOptions): Promise<RangeRow[]>;
    funnel(stream: string, steps: readonly string[], q: FunnelQuery, opts?: FunnelOptions): Promise<FunnelResult>;
    /** How a range query would be answered, without running it. */
    explainRead(stream: string, q: RangeQuery): ReadPlan;
    readonly cache: SegmentCache;
};
export declare const createEngine: (cfg: ResolvedConfig, options: EngineOptions) => Engine;
