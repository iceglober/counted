/**
 * Retention cohorts.
 *
 * Two things worth stating before the SQL.
 *
 * **There is no `date_trunc` here.** Both axes — the period a person was first
 * seen in, and the periods they came back in — are assigned by looking the
 * timestamp up in the domain's edge array, exactly as the series compiler
 * does. That removes v1's `date_trunc($n, timestamp)` where the *unit* was a
 * bound parameter and, uniquely in that codebase, was never validated against
 * an allowlist. The parameter is gone rather than guarded, which is the
 * stronger fix.
 *
 * **Cohorts are keyed on `person_id`, never on a visit.** v1 cohorted on
 * `session_id`, and a session ends after 30 minutes idle, so a session id
 * essentially never appeared in two different day or week buckets: every
 * cohort past period 0 was ~0 by construction, under a column headed "Users".
 * The domain makes a visit-scoped retention unconstructible; this compiler
 * refuses rows without a person, so an unidentified project honestly returns
 * nothing rather than a grid of zeros.
 */

import { TimeAxis, type Retention, type TimeAxis as Axis } from "@counted/domain";
import { EVENTS_TABLE } from "../sql/schema";
import { compilePredicate } from "./predicate";
import type { Params } from "./params";

export type CohortSpec = {
  readonly project: string;
  readonly retention: Retention;
  readonly from: Date;
  readonly to: Date;
};

/** Tenancy, window, and the requirement that there is a person to follow. */
const base = (spec: CohortSpec, alias: string, params: Params): readonly string[] => [
  `${alias}.project_id = ${params.add(spec.project)}::uuid`,
  `${alias}.occurred_at >= ${params.add(spec.from)}`,
  `${alias}.occurred_at < ${params.add(spec.to)}`,
  `${alias}.person_id IS NOT NULL`,
];

const eventFilter = (
  names: readonly string[] | undefined,
  alias: string,
  params: Params,
): readonly string[] =>
  names === undefined || names.length === 0
    ? []
    : [`${alias}.name = ANY(${params.add([...names])}::text[])`];

/**
 * One statement returning `(cohort_ix, cohort_size, period_ix, returned)`.
 *
 * The size is repeated on every row of a cohort; the reader dedupes it. That
 * is one round trip instead of two, and the alternative — a separate size
 * query — could see a different snapshot.
 */
export const compileCohorts = (spec: CohortSpec, axis: Axis, params: Params): string => {
  const { retention } = spec;
  const buckets = TimeAxis.bucketCount(axis);
  const edges = params.add(TimeAxis.edgeMillis(axis).map((ms) => new Date(ms)));
  const lastIx = params.add(buckets - 1);

  const startFilter = [
    ...base(spec, "e", params),
    ...eventFilter(retention.startEvents, "e", params),
    ...(retention.where === undefined ? [] : [compilePredicate(retention.where, params)]),
  ].join("\n      AND ");

  const returnNames = retention.returnEvents ?? retention.startEvents;
  const returnFilter = [
    ...base(spec, "e", params),
    ...eventFilter(returnNames, "e", params),
    ...(retention.where === undefined ? [] : [compilePredicate(retention.where, params)]),
  ].join("\n      AND ");

  return `
  WITH first_seen AS (
    SELECT e.person_id, MIN(e.occurred_at) AS first_at
    FROM ${EVENTS_TABLE} e
    WHERE ${startFilter}
    GROUP BY 1
  ),
  cohort AS (
    SELECT person_id,
           width_bucket(first_at, ${edges}::timestamptz[]) - 1 AS cohort_ix
    FROM first_seen
    WHERE width_bucket(first_at, ${edges}::timestamptz[]) - 1 BETWEEN 0 AND ${lastIx}
  ),
  sized AS (
    SELECT cohort_ix, COUNT(*) AS cohort_size FROM cohort GROUP BY 1
  ),
  activity AS (
    SELECT DISTINCT
           c.cohort_ix,
           c.person_id,
           width_bucket(e.occurred_at, ${edges}::timestamptz[]) - 1 AS period_ix
    FROM cohort c
    JOIN ${EVENTS_TABLE} e ON e.person_id = c.person_id
    WHERE ${returnFilter}
      AND width_bucket(e.occurred_at, ${edges}::timestamptz[]) - 1 BETWEEN c.cohort_ix AND ${lastIx}
  )
  SELECT a.cohort_ix,
         s.cohort_size,
         a.period_ix,
         COUNT(DISTINCT a.person_id) AS returned
  FROM activity a
  JOIN sized s ON s.cohort_ix = a.cohort_ix
  GROUP BY 1, 2, 3
  ORDER BY 1, 3
`;
};

export type CohortRow = {
  readonly cohort_ix: number | string;
  readonly cohort_size: number | string;
  readonly period_ix: number | string;
  readonly returned: number | string;
};

/**
 * Turn rows back into the shapes the domain's `buildGrid` expects, mapping
 * bucket indices to instants through the same axis that produced them.
 *
 * Sizes are deduplicated here. Note this returns only cohorts that had *some*
 * activity — a cohort whose members never returned at all still appears,
 * because period 0 is activity by definition.
 */
export const readCohortRows = (
  rows: readonly CohortRow[],
  axis: Axis,
): {
  sizes: readonly { cohortStart: import("@counted/domain").Instant; size: number }[];
  observations: readonly {
    cohortStart: import("@counted/domain").Instant;
    periodStart: import("@counted/domain").Instant;
    returned: number;
  }[];
} => {
  const starts = TimeAxis.bucketStarts(axis);
  const sizes = new Map<number, number>();
  const observations: {
    cohortStart: import("@counted/domain").Instant;
    periodStart: import("@counted/domain").Instant;
    returned: number;
  }[] = [];

  for (const row of rows) {
    const cohortIx = Number(row.cohort_ix);
    const periodIx = Number(row.period_ix);
    const cohortStart = starts[cohortIx];
    const periodStart = starts[periodIx];
    if (cohortStart === undefined || periodStart === undefined) continue;

    sizes.set(cohortIx, Number(row.cohort_size));
    observations.push({ cohortStart, periodStart, returned: Number(row.returned) });
  }

  return {
    sizes: [...sizes.entries()]
      .map(([ix, size]) => ({ cohortStart: starts[ix]!, size }))
      .sort((a, b) => Number(a.cohortStart) - Number(b.cohortStart)),
    observations,
  };
};
