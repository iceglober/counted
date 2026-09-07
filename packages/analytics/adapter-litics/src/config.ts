/**
 * The litics config — the schema artifact the whole engine is generated from.
 *
 * Treat this the way `contract/gen` is treated: one
 * source of truth, and drift fails CI. The DDL generator, the ingest builders,
 * the pack step and the read engine all read this object, so a column you
 * query is a column you migrated — pass a different config to
 * `generateMigrations` than to `createEngine` and you get reads against
 * tables that do not exist.
 *
 * Three decisions here are load-bearing and each one is a promise the rest of
 * the adapter keeps.
 *
 * **The actor is the visit, not the person.** litics has exactly one
 * `actor_id` per stream, it is `NOT NULL`, and it is the entity that `uniques`
 * counts and `funnel` follows. Most Counted events have no person — a
 * `PersonId` exists only where the customer called `identify()` — so person
 * cannot be the actor without dropping every anonymous event on the floor.
 * The consequence is stated rather than hidden: `uniques` here is *unique
 * visits*, and a funnel measures steps completed by one visit. Person-basis
 * uniqueness needs a second stream keyed on `PersonId`, and `AnalyticsEngine`
 * currently has no way to ask for one — `SeriesQuery` carries no counting
 * basis. Declaring that stream now would build tables nothing writes and
 * charts that are empty by construction, which is the exact failure this
 * codebase refuses. See the hand-off note.
 *
 * **The dimension set is closed, and it is exactly what an event carries.**
 * `SystemProperties` in `@counted/ingestion-domain` is seven fields; those
 * seven plus `event_type` are the dimensions. Six come from the SDK. The
 * seventh, `country`, is derived at ingest from the request address and the
 * address is thrown away — so the column here is the *only* record that a
 * request came from anywhere, and it is two letters wide. A declared
 * dimension is a column in every segment and a slot in every summary row, so
 * filtering and grouping by it never opens a segment; anything a customer
 * sends beyond these lands in `props`.
 *
 * Adding a dimension is not a config edit. The generated DDL creates tables; it
 * does not alter them. A database that already has the tables keeps the shape
 * it was created with. Adding a dimension therefore requires an explicit
 * schema and stored-segment update path.
 *
 * **Retention is written in days, never months.** litics' `intervalSeconds`
 * parses second/minute/hour/day/week and returns `null` for months, and
 * `plan.ts` compares a query's window against the retention to refuse a
 * question whose answer would be silently truncated. A retention it cannot
 * parse is a check it cannot make.
 */

import { defineLitics, dimOrdinal, resolveConfig, type ResolvedConfig } from "@litics/core";
import { DIMENSIONS } from "@counted/analytics-domain";

/**
 * The one stream. Funnels run within a stream, so every event Counted takes
 * has to live in the same one.
 */
export const STREAM = "events";

/** Every litics object lands here. Separate from the application's tables. */
export const SCHEMA = "analytics";

/**
 * The host table for the tenancy hierarchy.
 *
 * litics maintains a closure table (`analytics.org_tree`) from this by trigger,
 * so a scope set at workspace level sees the whole subtree — which is what
 * makes "unique visitors across a workspace" fall out of project-level
 * summaries instead of needing a query. It has to be one table holding *both*
 * levels, because a closure table walks one parent column; Counted's own
 * `workspace` and `project` tables cannot be it. Rows: one per workspace
 * (`parent_id` null) and one per project (`parent_id` = its workspace).
 */
export const ORG_TABLE = "public.analytics_org";

/**
 * Events are stamped with the MOST SPECIFIC tenant — the project. Anything
 * coarser and the hierarchy has nothing to aggregate.
 */
export const TENANT_LEVEL = "project";

/**
 * The seven per-event attributes, plus the event name.
 *
 * Widths are about the *global* dictionary: `analytics.dims` is keyed by
 * dimension name across all tenants, so `int2` (~32k distinct values) is a
 * ceiling on how many distinct values every Counted customer has between them.
 * `os_name` is canonicalised to a closed set and `locale` is a BCP-47 tag, so
 * both are safely small. `device_model`, `os_version`, `app_version` and
 * `sdk_version` are open sets that grow with every customer's release cadence
 * and get `int4`.
 *
 * `country` is `int2` and could not be anything else: ISO 3166-1 assigns 249
 * alpha-2 codes and the ingestion domain refuses anything that is not two
 * upper-case letters, so the dictionary for this name can never exceed 676 rows
 * however many customers there are. It is the one dimension with a hard,
 * externally-fixed ceiling.
 */
const DIMENSION_DEFS = [
  { name: "os_name", type: "int2" },
  { name: "os_version", type: "int4" },
  { name: "locale", type: "int2" },
  { name: "app_version", type: "int4" },
  { name: "device_model", type: "int4" },
  { name: "sdk_version", type: "int4" },
  { name: "country", type: "int2" },
] as const;

/**
 * No numeric measures are declared, and that is a statement about the product
 * rather than an oversight.
 *
 * A measure is an additive numeric fact carried on *every* event. Counted's
 * SDKs send event properties, which are an open jsonb bag; nothing in the
 * ingestion vocabulary is a declared numeric fact. Declaring one anyway would
 * add a column no writer fills and a summary that sums zeros — a chart of a
 * flat line at nought, which reads as "we had no revenue" rather than "we do
 * not collect that".
 *
 * To add one: name it here, teach ingestion to fill it, and
 * `SchemaCatalog.measures` starts returning it. Until then
 * `AnalyticsEngine.sums` refuses by name, which is the truthful answer.
 */
const MEASURE_DEFS: readonly { readonly name: string; readonly type: "int8" | "float8" }[] = [];

/**
 * How long events are kept, in days.
 *
 * `MAX_WINDOW` in the analytics domain is 730 days, so this is 760 — a month
 * of slack past the longest question anyone can ask. Retention applies to
 * whole segments: a segment whose newest event is older than this is deleted
 * by the compactor, so a straddling segment lives slightly longer than the
 * number says, never shorter. A query that reaches past it is refused rather
 * than answered with a truncated series — see `plan.ts`.
 */
export const SEGMENT_RETENTION_DAYS = 760;

/**
 * The longest window a funnel may cover, in days.
 *
 * A funnel decodes three columns of every segment its window overlaps and
 * sorts the step events by actor in memory. That is milliseconds per month of
 * one project's traffic and it stays that way at 95 days; a two-year funnel
 * over a busy workspace would not. Ninety-five rather than ninety so a 90-day
 * funnel has a margin at the edge.
 */
export const FUNNEL_MAX_DAYS = 95;

/**
 * Events per segment. litics' default, stated here so the number that decides
 * how many summary rows a read touches is written down in the config it
 * belongs to. Ten thousand events is about 160 KB on the wire, and a day of
 * one busy project is a handful of them.
 */
export const SEGMENT_ROWS = 10_000;

export const config = defineLitics({
  schema: SCHEMA,
  tenancy: {
    // Workspace and project ids are branded strings, not uuids: `WorkspaceId`
    // and `ProjectId` wrap `string` and accept anything up to MAX_ID_LENGTH.
    type: "text",
    hierarchy: { table: ORG_TABLE, id: "id", parent: "parent_id" },
  },
  streams: {
    [STREAM]: {
      // A VisitId is a branded string. See the note at the top of this file
      // about what that makes `uniques` mean.
      actorType: "text",
      dimensions: DIMENSION_DEFS,
      measures: MEASURE_DEFS,
      // Deliberately an OPEN set: an event name is customer-defined, and a
      // closed list here would make litics throw on the first event of a name
      // nobody predicted.
      // Counted's ingest is idempotent on an SDK-supplied key, and the dedup
      // ledger in public.ingest_receipts is committed atomically with the
      // events. A staging index alone would forget keys when rows are packed.
      idempotentIngest: false,
      segmentRows: SEGMENT_ROWS,
      retention: `${SEGMENT_RETENTION_DAYS} days`,
      // Inside a segment, events sort by time and then by event type, which
      // is the column every dashboard question filters on first.
      sortBy: "event_type",
    },
  },
});

/**
 * The resolved form — defaults filled in, identifiers validated. Every builder
 * takes this, never the literal config.
 *
 * Resolved once at module load on purpose: `resolveConfig` throws on an
 * invalid config, so a typo in a dimension name fails at import rather than on
 * the first query of the day.
 */
export const resolved: ResolvedConfig = resolveConfig(config);

const stream = resolved.streams.find((s) => s.name === STREAM);
if (stream === undefined) {
  // Unreachable: the stream is a literal key of the config above.
  throw new Error(`litics config has no stream "${STREAM}"`);
}

/** The resolved stream, looked up once. */
export const resolvedStream = stream;

/**
 * Every dimension a segment carries as a column of its own — what a filter or
 * a breakdown may name. `event_type` first, then the declared dimensions.
 */
export const INDEXED_DIMENSIONS: readonly string[] = [
  "event_type",
  ...resolvedStream.dimensions.map((d) => d.name),
];

/** Declared numeric measures. Empty today; see `MEASURE_DEFS`. */
export const DECLARED_MEASURES: readonly string[] = resolvedStream.measures.map((m) => m.name);

/**
 * Dimensions the product names but no column carries.
 *
 * Empty today — `country` was the only entry and now has a column. Kept, and
 * kept derived from `DIMENSIONS` rather than deleted, because "we do not have
 * that column" and "we have never heard of that field" are different answers to
 * a person: the domain's `DimensionCatalog` models them as different states,
 * `plan.ts` refuses them with different sentences, and the next dimension we
 * design before we collect lands here without any code changing.
 */
export const PLANNED_DIMENSIONS: readonly string[] = DIMENSIONS.filter(
  (d) => d.availability === "planned" && !INDEXED_DIMENSIONS.includes(d.name),
).map((d) => d.name);

/**
 * The dictionary key a dimension's values are encoded under.
 *
 * Event types are namespaced per stream (`events.event_type`); every other
 * dimension shares one dictionary across streams. Getting this wrong returns
 * ids from the wrong dimension, which reads as "no data" rather than as an
 * error, so it lives in one function.
 */
export const dictionaryKey = (dimension: string): string =>
  dimension === "event_type" ? `${STREAM}.event_type` : dimension;

/** `analytics.events` — staging, where events are written and live for minutes. */
export const stagingTable = (): string => `${resolved.schema}.${STREAM}`;

/** `analytics.events_segments` — the immutable packed tier. */
export const segmentsTable = (): string => `${resolved.schema}.${STREAM}_segments`;

/** `analytics.events_summary` — one row per (segment, hour, event type). */
export const summaryTable = (): string => `${resolved.schema}.${STREAM}_summary`;

/** `analytics.events_summary_dims` — the same cell split by one dimension's value: (dim, value). */
export const summaryDimsTable = (): string => `${resolved.schema}.${STREAM}_summary_dims`;

/** A dimension's `dim` ordinal in the marginal table: its position in the declared list. */
export const dimensionOrdinal = (dimension: string): number => dimOrdinal(resolvedStream, dimension);

/** `analytics.org_tree` — the closure table litics maintains from ORG_TABLE. */
export const orgTreeTable = (): string => `${resolved.schema}.org_tree`;

/** `analytics.dims` — the shared value dictionary. */
export const dimsTable = (): string => `${resolved.schema}.dims`;
