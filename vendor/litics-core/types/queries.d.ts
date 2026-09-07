/**
 * Ingest builders, all scoped to a stream. Each returns `{ sql, parameters }`
 * with $1..$n placeholders — adapters execute them verbatim (pg via
 * client.query, Kysely via CompiledQuery.raw, etc.). Reads live in the
 * engine (`createEngine`), which needs a connection of its own.
 */
import type { ResolvedConfig } from "./config.js";
export interface SqlStatement {
    sql: string;
    parameters: unknown[];
}
export interface TrackEvent {
    /** number/bigint for int8 streams; string for uuid/text streams. */
    actor: number | bigint | string;
    /** Required when tenancy is configured: the MOST SPECIFIC org the event
     * belongs to (e.g. the location, not the partner). */
    tenant?: string | number | bigint;
    /** Event type name; dictionary-encoded server-side, namespaced per stream. */
    type: string;
    ts?: Date | string;
    props?: Record<string, unknown>;
    session?: number | bigint | null;
    /** Provide a UUIDv7 for time-ordered ids; defaults to gen_random_uuid(). */
    eventId?: string;
    /** Values for the stream's dimensions, by name: { country: 'US' }. */
    dims?: Record<string, string | null | undefined>;
    /** Values for the stream's measures, by name: { billed_cents: 12500 }. */
    measures?: Record<string, number | bigint | null | undefined>;
}
export declare function track(cfg: ResolvedConfig, streamName: string, e: TrackEvent): SqlStatement;
/** One round trip for many events: a single jsonb array parameter. */
export declare function trackBatch(cfg: ResolvedConfig, streamName: string, events: TrackEvent[]): SqlStatement;
/**
 * Run the generated backfill function for one of the stream's sources:
 * copies rows with ts in [from, to) from the source table into the stream
 * (creating historical partitions as needed). Returns rows copied.
 * Backfill up to the moment migrations installed the trigger; the trigger
 * covers everything after.
 */
export declare function backfill(cfg: ResolvedConfig, streamName: string, table: string, range: {
    from: Date | string;
    to: Date | string;
}): SqlStatement;
/** Dictionary id for a dimension value (null result = value never seen). */
export declare function dimId(cfg: ResolvedConfig, dim: string, value: string): SqlStatement;
