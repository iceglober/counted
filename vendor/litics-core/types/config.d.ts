/**
 * Litics configuration. The config drives DDL generation (migrations), the
 * ingest builders, the pack step and the read engine, so the SAME config
 * object must be passed to all of them — a column you query must be a
 * column you migrated.
 *
 * Events are organized into STREAMS: one staging table, one segments table
 * and one summary table per stream, each with its own dimensions, measures
 * and retention. Use one stream per event family (product events, API
 * telemetry, audit, ...). Funnels run within a stream, so events you funnel
 * across belong together.
 *
 * All identifiers and interval strings are validated because they are
 * interpolated into generated SQL (values are always bound parameters).
 */
export interface DimensionDef {
    /** Column name on the stream tables and key in the shared dims dictionary. */
    name: string;
    /**
     * Width of the dictionary id column. int2 caps at ~32k distinct values
     * per dimension — right for countries/devices/versions; use int4 for
     * higher-cardinality dimensions. Default: 'int2'.
     */
    type?: "int2" | "int4";
}
export interface MeasureDef {
    /** Additive numeric column on every event; summaries store per-hour sums. */
    name: string;
    /** 'int8' for integer amounts (cents, counts); 'float8' for durations/ratios. Default: 'int8'. */
    type?: "int8" | "float8";
}
export interface SourceDef {
    /** Existing table this stream shadows (optionally schema-qualified). */
    table: string;
    /** Column holding the actor id. */
    actor: string;
    /** Event type: a fixed name, or { column } to read it from each row. */
    eventType: string | {
        column: string;
    };
    /** Column holding the event timestamp (drives the trigger and backfill range). */
    ts: string;
    /** Mapping: stream dimension name -> source column. */
    dims?: Record<string, string>;
    /** Mapping: stream measure name -> source column. */
    measures?: Record<string, string>;
    /** Column holding the tenant id (required when tenancy is configured). */
    tenant?: string;
    /** Columns copied into props. */
    props?: readonly string[];
    /**
     * When events happen. 'insert' (default) for append-only tables.
     * 'insert_or_update' for mutable rows whose eventType COLUMN transitions
     * (e.g. a status field): fires on insert, and again whenever that column
     * changes — the update event is stamped now(), since the row's own
     * timestamp column doesn't move. Requires eventType: { column }.
     */
    on?: "insert" | "insert_or_update";
    /**
     * Install triggers so rows become events automatically (atomic, catches
     * writes from every client, not just your app). Default true.
     */
    trigger?: boolean;
}
export interface StreamConfig {
    /**
     * Type of actor_id — the entity uniques count and funnels follow.
     * 'int8' for numeric keys, 'uuid'/'text' for platforms with UUID or
     * string primary keys. Default: 'int8'.
     */
    actorType?: "int8" | "uuid" | "text";
    /**
     * Dictionary-encoded dimension columns. A declared dimension gets its own
     * column in every segment and a slot in every summary row, so filtering
     * and grouping by it never opens a segment. Anything undeclared still
     * lands in `props`.
     */
    dimensions?: readonly DimensionDef[];
    /**
     * Optional closed set of event type names. When declared, track(),
     * funnel(), source eventType literals, and event_type filters are
     * checked against it. Omit for an open set.
     */
    eventTypes?: readonly string[];
    /**
     * Additive numeric facts carried on every event (dollar amounts,
     * durations). Summaries store per-hour sums of each measure, so dollar
     * dashboards never open a segment. Query via sums(stream, measure, range).
     */
    measures?: readonly MeasureDef[];
    /**
     * Existing tables that feed this stream. Each source generates a shadow
     * trigger (new rows -> events, zero app code) and a backfill function
     * (history -> events, one call per range).
     */
    sources?: readonly SourceDef[];
    /**
     * Add a unique index on event_id in staging so a redelivered event is
     * refused while its first copy is still staged. The dedup window is
     * staging residency — minutes, not days. Default: false.
     */
    idempotentIngest?: boolean;
    /**
     * Events per segment. The compactor packs staged rows into segments of
     * about this many. Bigger segments amortise per-segment overhead and
     * compress better; smaller ones prune more finely. Default 10000,
     * accepted range [1000, 100000].
     */
    segmentRows?: number;
    /**
     * How long segments are kept. A segment whose newest event is older than
     * this is dropped whole — a segment is never edited, so retention is a
     * DELETE of rows, not a rewrite. Default '5 years'.
     */
    retention?: string;
    /**
     * Secondary sort inside a segment, after time: 'event_type' or a declared
     * dimension. Sorting by the column most queries filter on makes it
     * run-length compressible. Default 'event_type'.
     */
    sortBy?: string;
}
export interface TenancyDef {
    /** Type of tenant ids. Default: 'uuid'. */
    type?: "uuid" | "text" | "int8";
    /**
     * Hierarchical scoping: point at your org table and litics maintains a
     * closure table (`org_tree`) via triggers, so a scope set to ANY level of
     * the tree sees its whole subtree. Omit for flat tenancy (scope = exact
     * tenant id).
     */
    hierarchy?: {
        table: string;
        id: string;
        parent: string;
    };
}
export interface LiticsConfig {
    /**
     * Multi-tenant mode. When set, every table gains a NOT NULL `tenant_id`
     * column, every query REQUIRES a scope, row-level security policies are
     * generated for the `litics_reader` role, and subtree answers come free:
     * counts and sums add, KMV sketches union without double counting.
     */
    tenancy?: TenancyDef;
    /** Schema holding all litics objects. Default: 'events'. */
    schema?: string;
    /** Event streams, keyed by name. Each becomes tables `<schema>.<name>`, `<name>_segments`, `<name>_summary`. */
    streams: Record<string, StreamConfig>;
}
export interface ResolvedSource {
    table: string;
    actor: string;
    eventType: string | {
        column: string;
    };
    ts: string;
    dims: Record<string, string>;
    measures: Record<string, string>;
    tenant: string | null;
    props: string[];
    on: "insert" | "insert_or_update";
    trigger: boolean;
}
export interface ResolvedStream {
    name: string;
    actorType: "int8" | "uuid" | "text";
    dimensions: Required<DimensionDef>[];
    measures: Required<MeasureDef>[];
    eventTypes: string[] | null;
    sources: ResolvedSource[];
    idempotentIngest: boolean;
    segmentRows: number;
    retention: string;
    sortBy: string;
}
export interface ResolvedTenancy {
    type: "uuid" | "text" | "int8";
    hierarchy: {
        table: string;
        id: string;
        parent: string;
    } | null;
}
export interface ResolvedConfig {
    schema: string;
    tenancy: ResolvedTenancy | null;
    streams: ResolvedStream[];
}
/** Parse a simple interval literal ('90 days', '1 hour') to seconds; null if
 * it uses units we can't compare (months) or doesn't parse. */
export declare function intervalSeconds(literal: string): number | null;
/**
 * Validate a config and return it with its literal types preserved, so a
 * typed client can check stream names and dimension keys at compile time:
 *
 *   const config = defineLitics({ streams: { product: { ... } } });
 */
export declare function defineLitics<const C extends LiticsConfig>(config: C): C;
export declare function resolveConfig(config: LiticsConfig): ResolvedConfig;
