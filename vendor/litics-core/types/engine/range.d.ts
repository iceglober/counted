/**
 * Counts, uniques and sums per bucket — the three range measures — over
 * summaries, decoded segments and the staging tail, all in one snapshot.
 *
 * The shape of the answer is one accumulator cell per (bucket, group ids),
 * filled from up to three sources chosen by the plan. Every source produces
 * the same three things — a count, a sum, a set of actors — so the merge is
 * one code path and a cell cannot tell where its numbers came from.
 */
import type { PoolClient } from "pg";
import type { ResolvedConfig } from "../config.js";
import { SegmentCache } from "./cache.js";
import { type FetchStats } from "./fetch.js";
import { type ReadPlan } from "./plan.js";
export type RangeQuery = {
    from: Date | string;
    to: Date | string;
    /** Bucket width as a fixed interval literal: '1 hour', '1 day', '15 minutes'. */
    step: string;
    /** Dimension filters by name. Arrays match any listed value; an empty array matches nothing. */
    filters?: Record<string, string | readonly string[]>;
    /** Break the answer out by these dimensions; each comes back as its own column. */
    groupBy?: readonly string[];
    /** Tenancy scope (required when tenancy is configured). */
    scope?: string | number | bigint;
};
export type Measure = {
    kind: "counts";
} | {
    kind: "uniques";
} | {
    kind: "sums";
    measure: string;
};
export type QueryOptions = {
    signal?: AbortSignal;
    /** Applied to every statement of the read via SET LOCAL. */
    statementTimeoutMs?: number;
};
export type RangeRow = {
    bucket: Date;
} & Record<string, Date | string | number | null>;
export type ReadStats = FetchStats & {
    path: ReadPlan["path"];
    summaryRows: number;
    tailRows: number;
    eventsScanned: number;
};
export declare const runRange: (cfg: ResolvedConfig, pool: {
    connect(): Promise<PoolClient>;
}, cache: SegmentCache, streamName: string, q: RangeQuery, measure: Measure, opts: QueryOptions, onStats?: (stats: ReadStats) => void) => Promise<RangeRow[]>;
