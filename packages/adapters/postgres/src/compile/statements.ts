/**
 * Whole statements for the three analysis-shaped requests.
 *
 * The series case is the one that matters. There is **no bucket expression in
 * this file** — the domain computed the edges, and Postgres is told which
 * bucket a row falls in by looking the timestamp up in that array:
 *
 *     width_bucket(occurred_at, $edges::timestamptz[])
 *
 * `time_bucket` and `date_trunc` appear nowhere. v1 had three bucketing
 * implementations (Timescale's, Postgres's, and a JS one for the zero-fill
 * axis) with nothing checking they agreed; when they drifted, points landed in
 * neighbouring buckets and the chart was quietly wrong. There is now one
 * implementation, it lives in the domain, and this adapter cannot disagree
 * with it because it does not have an opinion.
 */

import { TimeAxis, type Analysis, type Dimension, type FieldRef, type TimeAxis as Axis } from "@counted/domain";
import { EVENTS_TABLE } from "../sql/schema";
import { fieldAsLabel } from "./column-map";
import { compileMeasure } from "./measure";
import { compilePredicate } from "./predicate";
import type { Params } from "./params";

export type Compiled = { readonly sql: string; readonly values: readonly unknown[] };

export type ScalarSpec = {
  readonly project: string;
  readonly analysis: Analysis;
  readonly from: Date;
  readonly to: Date;
};

/**
 * The shared WHERE clause: project, half-open time bounds, event names, and
 * the predicate. Half-open matches the domain's bucket semantics, so an event
 * exactly on a boundary is counted once, in the window that starts there.
 */
const where = (spec: ScalarSpec, params: Params): string => {
  const clauses = [
    `project_id = ${params.add(spec.project)}::uuid`,
    `occurred_at >= ${params.add(spec.from)}`,
    `occurred_at < ${params.add(spec.to)}`,
  ];

  const names = spec.analysis.events ?? [];
  if (names.length > 0) clauses.push(`name = ANY(${params.add([...names])}::text[])`);
  if (spec.analysis.where !== undefined) {
    clauses.push(compilePredicate(spec.analysis.where, params));
  }
  return clauses.join("\n    AND ");
};

/** One number. */
export const compileScalar = (spec: ScalarSpec, params: Params): string => `
  SELECT ${compileMeasure(spec.analysis.measure, params)} AS value
  FROM ${EVENTS_TABLE}
  WHERE ${where(spec, params)}
`;

/**
 * One number per bucket, as `(bucket_ix, value)` pairs.
 *
 * `width_bucket` is 1-based and reports out-of-range values as `0` (before the
 * first edge) or `n+1` (at or after the last), so subtracting one gives the
 * domain's 0-based index and the HAVING filter drops anything outside the
 * axis. Gaps simply do not appear; the adapter densifies with
 * `TimeAxis.densify`, which fills from the axis rather than from whatever keys
 * the database happened to return.
 */
export const compileSeries = (spec: ScalarSpec, axis: Axis, params: Params): string => {
  const edges = params.add(TimeAxis.edgeMillis(axis).map((ms) => new Date(ms)));
  const buckets = TimeAxis.bucketCount(axis);
  return `
  SELECT width_bucket(occurred_at, ${edges}::timestamptz[]) - 1 AS bucket_ix,
         ${compileMeasure(spec.analysis.measure, params)} AS value
  FROM ${EVENTS_TABLE}
  WHERE ${where(spec, params)}
  GROUP BY 1
  HAVING width_bucket(occurred_at, ${edges}::timestamptz[]) - 1 BETWEEN 0 AND ${params.add(buckets - 1)}
  ORDER BY 1
`;
};

/**
 * One row per group.
 *
 * `LIMIT` is always applied — an unbounded high-cardinality group-by is how a
 * single tile takes a connection out of the pool for a minute. v1 applied a
 * limit only when the insight explicitly set one.
 */
export const compileBreakdown = (
  spec: ScalarSpec,
  dimension: Extract<Dimension, { by: "field" }>,
  limit: number,
  params: Params,
): string => {
  const label = fieldAsLabel(dimension.field, params);
  return `
  SELECT ${label} AS label,
         ${compileMeasure(spec.analysis.measure, params)} AS value
  FROM ${EVENTS_TABLE}
  WHERE ${where(spec, params)}
  GROUP BY 1
  ORDER BY value ${spec.analysis.orderBy === "asc" ? "ASC" : "DESC"}, label ASC
  LIMIT ${params.add(limit)}
`;
};

/** The field dimension a breakdown groups by, if the analysis names one. */
export const breakdownDimension = (a: Analysis): Extract<Dimension, { by: "field" }> | null => {
  const dim = (a.groupBy ?? []).find((d): d is Extract<Dimension, { by: "field" }> => d.by === "field");
  return dim ?? null;
};

/** Every field an analysis touches, for validating against a project's schema. */
export const referencedFields = (a: Analysis): readonly FieldRef[] => [
  ...(a.groupBy ?? []).flatMap((d) => (d.by === "field" ? [d.field] : [])),
];
