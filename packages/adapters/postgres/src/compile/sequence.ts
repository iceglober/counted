/**
 * Funnels.
 *
 * One statement, chained CTEs — not N round trips.
 *
 * v1 ran a query per step inside an `await` loop, and each step's query added
 * another `session_id IN (SELECT ...)` conjunct, so a five-step funnel meant
 * five serial round trips and fifteen correlated subqueries. Worse, those
 * conjuncts only asked whether a visit *contained* each event: order was never
 * checked and there was no deadline between steps, so a visit that fired
 * `purchase` on Monday and `view_product` on Friday counted as fully
 * converted. The doc-comment above that SQL claimed "in sequence".
 *
 * Here each step's CTE joins forward from the previous one:
 *
 *     e.occurred_at >  previous.t          — strictly after the step before
 *     e.occurred_at <= first.t0 + window   — inside the conversion deadline
 *
 * so ordering and the deadline are properties of the join rather than
 * something a comment asserts. Counts are non-increasing by construction,
 * because every CTE selects from the one before it — which is what makes
 * `Funnel.summarize`'s monotonicity check a real check on the *store* rather
 * than a tautology.
 */

import { Duration, type Funnel, type FunnelStep } from "@counted/domain";
import { EVENTS_TABLE } from "../sql/schema";
import { compilePredicate } from "./predicate";
import type { Params } from "./params";

export type SequenceSpec = {
  readonly project: string;
  readonly funnel: Funnel;
  readonly from: Date;
  readonly to: Date;
};

/** The column a funnel follows a subject by. */
const subjectColumn = (funnel: Funnel): string =>
  funnel.basis === "person" ? "person_id" : "visit_id";

/** Conditions every step shares: tenancy, the observation window, and — for a
 *  person-scoped funnel — that there is a person at all. A NULL subject cannot
 *  be followed across events, and counting it would silently inflate step 0. */
const baseConditions = (spec: SequenceSpec, alias: string, params: Params): readonly string[] => {
  const subject = subjectColumn(spec.funnel);
  const conditions = [
    `${alias}.project_id = ${params.add(spec.project)}::uuid`,
    `${alias}.occurred_at >= ${params.add(spec.from)}`,
    `${alias}.occurred_at < ${params.add(spec.to)}`,
    `${alias}.${subject} IS NOT NULL`,
  ];
  return conditions;
};

/** What makes an event count as this step. */
const stepConditions = (step: FunnelStep, alias: string, params: Params): readonly string[] => {
  const conditions = [`${alias}.name = ANY(${params.add([...step.events])}::text[])`];
  if (step.where !== undefined) {
    // The predicate compiler emits unqualified column names, which resolve to
    // the aliased events row inside each CTE.
    conditions.push(compilePredicate(step.where, params));
  }
  return conditions;
};

/**
 * Compile a funnel into a single statement returning one row of per-step
 * counts, in step order.
 */
export const compileSequence = (spec: SequenceSpec, params: Params): string => {
  const { funnel } = spec;
  const subject = subjectColumn(funnel);
  const windowMs = Duration.toMillis(funnel.conversionWindow);
  const ctes: string[] = [];

  funnel.steps.forEach((step, i) => {
    const alias = "e";
    if (i === 0) {
      // The cohort: every subject that took the first step, and when.
      ctes.push(`s0 AS (
    SELECT ${alias}.${subject} AS subject,
           MIN(${alias}.occurred_at) AS t0,
           MIN(${alias}.occurred_at) AS t
    FROM ${EVENTS_TABLE} ${alias}
    WHERE ${[...baseConditions(spec, alias, params), ...stepConditions(step, alias, params)].join("\n      AND ")}
    GROUP BY 1
  )`);
      return;
    }

    const prev = `s${i - 1}`;
    // t0 travels forward so the deadline is measured from the funnel's start,
    // not from the previous step. A five-step funnel with a one-hour window
    // means one hour end to end, not five.
    ctes.push(`s${i} AS (
    SELECT ${prev}.subject,
           ${prev}.t0,
           MIN(e.occurred_at) AS t
    FROM ${prev}
    JOIN ${EVENTS_TABLE} e
      ON e.${subject} = ${prev}.subject
     AND e.occurred_at > ${prev}.t
     AND e.occurred_at <= ${prev}.t0 + ${params.add(`${windowMs} milliseconds`)}::interval
     AND ${[...baseConditions(spec, "e", params), ...stepConditions(step, "e", params)].join("\n     AND ")}
    GROUP BY 1, 2
  )`);
  });

  const counts = funnel.steps
    .map((_, i) => `(SELECT COUNT(*) FROM s${i}) AS step_${i}`)
    .join(",\n         ");

  return `
  WITH ${ctes.join(",\n  ")}
  SELECT ${counts}
`;
};

/** Read the single result row back into step order. */
export const readSequenceRow = (
  row: Record<string, unknown>,
  steps: number,
): readonly number[] =>
  Array.from({ length: steps }, (_, i) => Number(row[`step_${i}`] ?? 0));
