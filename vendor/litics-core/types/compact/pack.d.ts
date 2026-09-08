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
import { type PackResult } from "../segment.js";
export type PackWindow = {
    kind: "late" | "recent";
    boundaryUs: number;
};
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
/** Insert a packed segment and its summary rows. Returns the new segment id. */
export declare const insertPacked: (client: PoolClient, cfg: ResolvedConfig, st: ResolvedStream, tenant: string | null, series: "recent" | "late", { segment, summary }: PackResult) => Promise<number>;
export declare const packOnce: (client: PoolClient, cfg: ResolvedConfig, streamName: string, opts?: PackOptions) => Promise<PackOutcome | null>;
/** Tenants with rows waiting in staging (`[null]` when tenancy is off and rows exist). */
export declare const stagedTenants: (client: PoolClient, cfg: ResolvedConfig, streamName: string) => Promise<(string | null)[]>;
/**
 * Pack everything in staging for a stream (or one tenant of it), one
 * transaction per segment, under the per-tenant advisory lock. The last
 * segment is whatever is left, however small — this is "make it current
 * now", for tests and for operators, not the compactor's steady state.
 */
export declare const flush: (pool: Pool, cfg: ResolvedConfig, streamName: string, tenant?: string) => Promise<PackOutcome[]>;
