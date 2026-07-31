/**
 * Measures to SQL aggregates.
 *
 * `distinct` names its basis, so the store counts what was actually asked for.
 * v1 accepted `unique_users` publicly and compiled it to
 * `COUNT(DISTINCT session_id)` — answering a question about people with a
 * number about visits, with a comment in the source admitting it.
 *
 * Aggregates go through the same guarded numeric expression the comparison
 * operators use, so a non-numeric value contributes nothing instead of
 * aborting the statement.
 */

import { assertNever, type Measure } from "@counted/domain";
import { PROPERTIES } from "./column-map";
import { numericFromJsonb } from "./numeric";
import type { Params } from "./params";

export const compileMeasure = (m: Measure, params: Params): string => {
  switch (m.kind) {
    case "count":
      return "COUNT(*)";

    case "distinct":
      // Two different questions, two different columns. person_id is NULL for
      // anyone who never called identify(), and COUNT(DISTINCT) ignores NULLs,
      // so an unidentified project honestly reports zero people rather than
      // silently reporting its visit count.
      return m.basis === "person" ? "COUNT(DISTINCT person_id)" : "COUNT(DISTINCT visit_id)";

    case "aggregate": {
      const value = numericFromJsonb(PROPERTIES, params.add(m.property));
      switch (m.fn) {
        case "sum":
          return `COALESCE(SUM(${value}), 0)`;
        case "avg":
          return `AVG(${value})`;
        case "min":
          return `MIN(${value})`;
        case "max":
          return `MAX(${value})`;
        default:
          return assertNever(m.fn);
      }
    }

    default:
      return assertNever(m);
  }
};

/**
 * Whether the result of a measure can be NULL when nothing matched.
 *
 * SUM is coalesced above; AVG/MIN/MAX over an empty set are genuinely NULL and
 * the reader converts them to 0. Saying so here keeps that decision in one
 * place rather than scattered through row mapping.
 */
export const measureMayBeNull = (m: Measure): boolean =>
  m.kind === "aggregate" && m.fn !== "sum";
