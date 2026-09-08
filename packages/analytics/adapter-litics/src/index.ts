/**
 * @counted/analytics-adapter-litics — AnalyticsEngine over @litics/core.
 *
 * The only package that may import `@litics/core` or `@litics/compactor`
 * (`.dependency-cruiser.cjs`, rule 5).
 * The ingest builders return `{ sql, parameters }` with $1..$n placeholders,
 * executed verbatim through the `pg` pool; reads go through litics' own
 * engine, which takes a pool and answers each question from summaries,
 * segments and the staging tail in one snapshot.
 *
 * Read `config.ts` first. It is the schema artifact everything else is
 * generated from, and it records the three decisions that decide what the
 * engine can honestly answer: the actor is the visit, the dimension set is the
 * seven system properties, and no numeric measure is declared because Counted
 * collects none.
 *
 * Tenancy is configured with a hierarchy over `public.analytics_org`, so a
 * scope set at workspace level aggregates the whole subtree — counts and sums
 * add, actor sketches merge without double counting, and "unique visitors
 * across a workspace" comes out of project-level summaries.
 *
 * Requires Postgres 14 or later and nothing installed on it: the whole
 * schema is plain SQL and plpgsql, so a managed database is fine.
 */

export {
  config,
  INDEXED_DIMENSIONS,
  DECLARED_MEASURES,
  dictionaryKey,
  dimensionOrdinal,
  dimsTable,
  FUNNEL_MAX_DAYS,
  ORG_TABLE,
  orgTreeTable,
  PLANNED_DIMENSIONS,
  resolved,
  resolvedStream,
  SCHEMA,
  SEGMENT_RETENTION_DAYS,
  SEGMENT_ROWS,
  segmentsTable,
  stagingTable,
  STREAM,
  summaryDimsTable,
  summaryTable,
  TENANT_LEVEL,
} from "./config";

export {
  advance,
  alignFloor,
  densify,
  gridStarts,
  MAX_BUCKETS,
  monthSpans,
  stepInterval,
  stepMillis,
  wholeWindowStride,
  type MonthSpan,
} from "./bucketing";

export {
  planBreakdown,
  planFilters,
  planFunnel,
  planSeries,
  planSums,
  type BreakdownPlan,
  type FunnelPlan,
  type Planned,
  type RangeCall,
  type Refusal,
  type SeriesPlan,
} from "./plan";

export { execute, numberAt, timestampAt, type ExecOutcome, type QueryPool, type Row } from "./execute";
export { openBudget, type Budget } from "./budget";
export { cancelled, failureFor } from "./failures";

export {
  DEFAULT_CACHE_BYTES,
  LiticsAnalyticsEngine,
  type EnginePool,
  type LiticsEngineDeps,
  type SegmentReader,
} from "./engine";

export {
  CATALOG_DEADLINE,
  CATALOG_LOOKBACK,
  LiticsSchemaCatalog,
  MAX_DIMENSION_VALUES,
  type LiticsCatalogDeps,
} from "./catalog";

export {
  analyticsMigrations,
  analyticsSchemaDrift,
  expectedAnalyticsSchema,
  INTROSPECTION,
  ORG_TABLE_STATEMENTS,
  orgRemove,
  orgUpsert,
} from "./migrate";

export { packNow, type PackOutcome, type PackPool } from "./pack";
export { LiticsEventRetention, type LiticsRetentionDeps } from "./retention";
export {
  createLiticsCompactor,
  type Compactor,
  type CompactorLogger,
  type CompactorStatus,
  type LiticsCompactorDeps,
} from "./compactor";

export {
  LiticsEventSink,
  PACK_CHANNEL,
  toTrackEvent,
  writeStatement,
  type LiticsSinkDeps,
  type WriteClient,
  type WritePool,
} from "./sink";
