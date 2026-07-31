/**
 * Indexes.
 *
 * Chosen against the query shapes the contract suite actually exercises, not
 * against a general sense that indexes are good. Every one below earns its
 * write cost on a specific access path; where an access path cannot be indexed
 * usefully, that is said out loud rather than papered over.
 *
 * Declared on the parent table: PostgreSQL propagates an index on a
 * partitioned table to every existing and future partition, so the
 * `partitions.ensure` job does not have to remember to create them.
 */

import { EVENTS_TABLE } from "./schema";

/**
 * The primary access path. Every analytical query filters by project and an
 * absolute time range, so this is the index almost everything rides on.
 * Partition pruning narrows to the months involved; this narrows within them.
 */
export const IDX_PROJECT_TIME = /* sql */ `
CREATE INDEX IF NOT EXISTS events_project_time_idx
  ON ${EVENTS_TABLE} (project_id, occurred_at DESC);
`;

/**
 * Event-name filtering is the most common narrowing after project and time —
 * `events: ["page_view"]` on nearly every tile, and every funnel step.
 */
export const IDX_PROJECT_NAME_TIME = /* sql */ `
CREATE INDEX IF NOT EXISTS events_project_name_time_idx
  ON ${EVENTS_TABLE} (project_id, name, occurred_at DESC);
`;

/**
 * Distinct-visit counting, which is the default measure on most dashboards.
 *
 * v1's equivalent was `(project_id, session_id)` with no timestamp, so a
 * time-bounded distinct count could not use it and fell back to a scan. The
 * trailing `visit_id` is what allows an index-only scan for
 * `COUNT(DISTINCT visit_id)` inside a window.
 */
export const IDX_PROJECT_TIME_VISIT = /* sql */ `
CREATE INDEX IF NOT EXISTS events_project_time_visit_idx
  ON ${EVENTS_TABLE} (project_id, occurred_at, visit_id);
`;

/**
 * Person-scoped work: retention cohorts and cross-visit funnels.
 *
 * Partial, because `person_id` is NULL for every customer who has not called
 * identify() — which is the default and, for most projects, all of them.
 * Indexing those nulls would pay for rows the index can never serve.
 */
export const IDX_PROJECT_PERSON_TIME = /* sql */ `
CREATE INDEX IF NOT EXISTS events_project_person_time_idx
  ON ${EVENTS_TABLE} (project_id, person_id, occurred_at)
  WHERE person_id IS NOT NULL;
`;

/**
 * Properties. **The index v1 never had** — every property filter and every
 * property breakdown there was a sequential scan of the project's slice.
 *
 * `jsonb_path_ops` is deliberate: it indexes only containment (`@>`), which
 * makes it roughly a third the size of the default `jsonb_ops` and faster to
 * search. The trade is that it cannot serve key-existence (`?`) queries.
 *
 * This imposes a requirement on the IR compiler (#34): **property equality
 * must compile to containment**, `properties @> '{"plan":"pro"}'`, not to
 * `properties ->> 'plan' = 'pro'`. The second form is not sargable and will
 * scan no matter what index exists. There is a test asserting the compiler
 * emits containment.
 */
export const IDX_PROPERTIES_GIN = /* sql */ `
CREATE INDEX IF NOT EXISTS events_properties_gin_idx
  ON ${EVENTS_TABLE} USING gin (properties jsonb_path_ops);
`;

/**
 * A cheap coarse index over time alone.
 *
 * Mostly redundant with partition pruning plus the project+time btree, and
 * kept anyway because it costs a few kilobytes per partition and serves the
 * queries that have no project filter: the retention purge, and any
 * whole-table maintenance. On append-only, time-ordered data BRIN's page
 * ranges are near-perfectly correlated, which is the case it is built for.
 */
export const IDX_OCCURRED_BRIN = /* sql */ `
CREATE INDEX IF NOT EXISTS events_occurred_brin_idx
  ON ${EVENTS_TABLE} USING brin (occurred_at) WITH (pages_per_range = 32);
`;

export const INDEX_STATEMENTS: readonly string[] = [
  IDX_PROJECT_TIME,
  IDX_PROJECT_NAME_TIME,
  IDX_PROJECT_TIME_VISIT,
  IDX_PROJECT_PERSON_TIME,
  IDX_PROPERTIES_GIN,
  IDX_OCCURRED_BRIN,
];

/**
 * Access paths that are deliberately **not** indexed, so the next person does
 * not add one without reading this:
 *
 * - **Numeric comparisons on a property** (`amount > 100`). GIN cannot serve a
 *   range over an arbitrary JSONB key, and the set of keys is customer-defined
 *   so per-key expression indexes cannot be created ahead of time. These scan
 *   within the project-and-time slice, which partition pruning and the btree
 *   have already made small. If a specific key becomes hot for a specific
 *   customer, a targeted expression index is the answer — not a general one.
 *
 * - **`name` alone.** Always used together with `project_id`; a standalone
 *   index would be write cost for no read.
 *
 * - **`ingested_at`.** Written on every row and read only for debugging.
 */
export const UNINDEXED_BY_DESIGN = [
  "numeric comparisons on customer properties",
  "name without project_id",
  "ingested_at",
] as const;
