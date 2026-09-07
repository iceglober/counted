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
  eventType: string | { column: string };
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
  hierarchy?: { table: string; id: string; parent: string };
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
  eventType: string | { column: string };
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
  hierarchy: { table: string; id: string; parent: string } | null;
}

export interface ResolvedConfig {
  schema: string;
  tenancy: ResolvedTenancy | null;
  streams: ResolvedStream[];
}

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 604800,
};

/** Parse a simple interval literal ('90 days', '1 hour') to seconds; null if
 * it uses units we can't compare (months) or doesn't parse. */
export function intervalSeconds(literal: string): number | null {
  const m = /^(\d+)\s*(second|minute|hour|day|week)s?$/i.exec(literal.trim());
  if (!m) return null;
  return Number(m[1]) * UNIT_SECONDS[m[2]!.toLowerCase()]!;
}

const IDENT = /^[a-z][a-z0-9_]*$/;
// Interval / retention strings land inside single-quoted SQL literals.
const SQL_LITERAL = /^[a-z0-9 */:,-]+$/i;

const RESERVED_COLUMNS = new Set([
  "ts",
  "staged_at",
  "event_id",
  "actor_id",
  "tenant_id",
  "session_id",
  "event_type",
  "props",
  "bucket",
  "n",
  "actors",
  // The alias `sums()` gives its aggregate. A grouped dimension comes back as
  // a column named after itself, so a dimension called `sum` would collide
  // with the number in the same row and the driver would keep one of the two.
  "sum",
  "dim",
  "value",
  "id",
  // Segment and summary table columns. A dimension with one of these names
  // would collide with the column that describes the segment it lives in.
  "segment_id",
  "ts_min",
  "ts_max",
  "format",
  "series",
  "actor",
  "actor_hash",
  "extra",
  "extra_meta",
  "raw_bytes",
  "created_at",
]);

/** Shared-infrastructure table names a stream may not shadow, plus client
 * property names ("with", "dimId" can't collide — idents are lowercase). */
const RESERVED_STREAMS = new Set(["dims", "org_tree", "with"]);

function assertIdent(value: string, what: string): void {
  if (!IDENT.test(value)) {
    throw new Error(`litics: ${what} ${JSON.stringify(value)} must match ${IDENT}`);
  }
}

function assertLiteral(value: string, what: string): void {
  if (!SQL_LITERAL.test(value)) {
    throw new Error(`litics: ${what} ${JSON.stringify(value)} contains characters not allowed in a SQL literal`);
  }
}

/**
 * Validate a config and return it with its literal types preserved, so a
 * typed client can check stream names and dimension keys at compile time:
 *
 *   const config = defineLitics({ streams: { product: { ... } } });
 */
export function defineLitics<const C extends LiticsConfig>(config: C): C {
  resolveConfig(config);
  return config;
}

export function resolveConfig(config: LiticsConfig): ResolvedConfig {
  const schema = config.schema ?? "events";
  assertIdent(schema, "schema");

  const streamNames = Object.keys(config.streams ?? {});
  if (streamNames.length === 0) {
    throw new Error("litics: config needs at least one stream");
  }

  let tenancy: ResolvedTenancy | null = null;
  if (config.tenancy) {
    const h = config.tenancy.hierarchy ?? null;
    if (h) {
      const TABLE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
      const COL = /^[A-Za-z_][A-Za-z0-9_]*$/;
      if (!TABLE_IDENT.test(h.table)) {
        throw new Error(`litics: tenancy hierarchy table ${JSON.stringify(h.table)} must match ${TABLE_IDENT}`);
      }
      for (const c of [h.id, h.parent]) {
        if (!COL.test(c)) {
          throw new Error(`litics: tenancy hierarchy column ${JSON.stringify(c)} must match ${COL}`);
        }
      }
    }
    tenancy = { type: config.tenancy.type ?? "uuid", hierarchy: h };
  }

  // Segment tables are `<stream>_segments` and `<stream>_summary`. A stream
  // named that way would share a table name with another stream's objects.
  const taken = new Set(streamNames);
  for (const name of streamNames) {
    for (const suffix of ["_segments", "_summary", "_summary_dims", "_default"]) {
      if (!name.endsWith(suffix)) continue;
      const other = name.slice(0, -suffix.length);
      if (taken.has(other)) {
        throw new Error(
          `litics: stream ${JSON.stringify(name)} collides with the ${suffix.slice(1)} table of stream ${JSON.stringify(other)}`,
        );
      }
    }
  }

  const streams = streamNames.map((name) => resolveStream(name, config.streams[name]!, tenancy));
  return { schema, tenancy, streams };
}

function resolveStream(name: string, stream: StreamConfig, tenancy: ResolvedTenancy | null): ResolvedStream {
  assertIdent(name, "stream name");
  if (RESERVED_STREAMS.has(name)) {
    throw new Error(`litics: stream name ${JSON.stringify(name)} is reserved`);
  }

  const dimensions = (stream.dimensions ?? []).map((d) => {
    assertIdent(d.name, `stream ${JSON.stringify(name)} dimension name`);
    if (RESERVED_COLUMNS.has(d.name)) {
      throw new Error(`litics: dimension name ${JSON.stringify(d.name)} is reserved`);
    }
    return { name: d.name, type: d.type ?? ("int2" as const) };
  });
  const dimNames = new Set(dimensions.map((d) => d.name));
  if (dimNames.size !== dimensions.length) {
    throw new Error(`litics: stream ${JSON.stringify(name)} has duplicate dimension names`);
  }

  const measures = (stream.measures ?? []).map((m) => {
    assertIdent(m.name, `stream ${JSON.stringify(name)} measure name`);
    if (RESERVED_COLUMNS.has(m.name) || dimNames.has(m.name)) {
      throw new Error(`litics: measure name ${JSON.stringify(m.name)} collides with a reserved or dimension column`);
    }
    return { name: m.name, type: m.type ?? ("int8" as const) };
  });
  const measureNames = new Set(measures.map((m) => m.name));
  if (measureNames.size !== measures.length) {
    throw new Error(`litics: stream ${JSON.stringify(name)} has duplicate measure names`);
  }

  const eventTypes = stream.eventTypes ? [...stream.eventTypes] : null;
  if (eventTypes) {
    if (eventTypes.length === 0) {
      throw new Error(`litics: stream ${JSON.stringify(name)} declares an empty eventTypes list`);
    }
    if (new Set(eventTypes).size !== eventTypes.length) {
      throw new Error(`litics: stream ${JSON.stringify(name)} has duplicate event types`);
    }
  }

  // Source tables/columns are quoted in generated SQL, so camelCase
  // (kysely-codegen reality) is fine; only structure is validated.
  const TABLE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
  const sources = (stream.sources ?? []).map((src) => {
    if (!TABLE_IDENT.test(src.table)) {
      throw new Error(`litics: source table ${JSON.stringify(src.table)} must match ${TABLE_IDENT}`);
    }
    const columns = [
      src.actor,
      src.ts,
      ...(typeof src.eventType === "object" ? [src.eventType.column] : []),
      ...Object.values(src.dims ?? {}),
      ...Object.values(src.measures ?? {}),
      ...(src.tenant ? [src.tenant] : []),
      ...(src.props ?? []),
    ];
    const COLUMN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (const col of columns) {
      if (!COLUMN_IDENT.test(col)) {
        throw new Error(`litics: source ${JSON.stringify(src.table)} column ${JSON.stringify(col)} must match ${COLUMN_IDENT}`);
      }
    }
    for (const dim of Object.keys(src.dims ?? {})) {
      if (!dimNames.has(dim)) {
        throw new Error(
          `litics: source ${JSON.stringify(src.table)} maps unknown dimension ${JSON.stringify(dim)} — declare it in stream ${JSON.stringify(name)}'s dimensions`,
        );
      }
    }
    for (const m of Object.keys(src.measures ?? {})) {
      if (!measureNames.has(m)) {
        throw new Error(
          `litics: source ${JSON.stringify(src.table)} maps unknown measure ${JSON.stringify(m)} — declare it in stream ${JSON.stringify(name)}'s measures`,
        );
      }
    }
    if (tenancy && !src.tenant) {
      throw new Error(`litics: source ${JSON.stringify(src.table)} needs a tenant column mapping — tenancy is configured`);
    }
    if (src.on === "insert_or_update" && typeof src.eventType === "string") {
      throw new Error(
        `litics: source ${JSON.stringify(src.table)} uses on: "insert_or_update", which requires eventType: { column } — update events fire when that column transitions`,
      );
    }
    if (eventTypes && typeof src.eventType === "string" && !eventTypes.includes(src.eventType)) {
      throw new Error(
        `litics: source ${JSON.stringify(src.table)} uses event type ${JSON.stringify(src.eventType)}, not in stream ${JSON.stringify(name)}'s eventTypes [${eventTypes.join(", ")}]`,
      );
    }
    return {
      table: src.table,
      actor: src.actor,
      eventType: src.eventType,
      ts: src.ts,
      dims: { ...(src.dims ?? {}) },
      measures: { ...(src.measures ?? {}) },
      tenant: src.tenant ?? null,
      props: [...(src.props ?? [])],
      on: src.on ?? "insert",
      trigger: src.trigger ?? true,
    };
  });
  if (new Set(sources.map((s) => s.table)).size !== sources.length) {
    throw new Error(`litics: stream ${JSON.stringify(name)} has duplicate source tables`);
  }

  const segmentRows = stream.segmentRows ?? 10000;
  if (!Number.isInteger(segmentRows) || segmentRows < 1000 || segmentRows > 100000) {
    throw new Error(`litics: stream ${JSON.stringify(name)} segmentRows must be an integer in [1000, 100000]`);
  }
  const retention = stream.retention ?? "5 years";
  assertLiteral(retention, "retention");
  const sortBy = stream.sortBy ?? "event_type";
  if (sortBy !== "event_type" && !dimensions.some((d) => d.name === sortBy)) {
    throw new Error(`litics: stream ${JSON.stringify(name)} sortBy ${JSON.stringify(sortBy)} is not 'event_type' or a declared dimension`);
  }

  return {
    name,
    actorType: stream.actorType ?? "int8",
    dimensions,
    measures,
    eventTypes,
    sources,
    idempotentIngest: stream.idempotentIngest ?? false,
    segmentRows,
    retention,
    sortBy,
  };
}
