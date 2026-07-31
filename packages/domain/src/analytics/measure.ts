/**
 * Measures — the number an analysis produces.
 *
 * `distinct` names its basis. v1 accepted `unique_users` as a public API
 * measure and compiled it to `COUNT(DISTINCT session_id)` with a comment
 * admitting it was an alias, so the API answered a question about people with
 * a number about visits. Here `distinct(person)` and `distinct(visit)` are
 * different measures, and the person one only produces sensible numbers on
 * identified events — which validation and the compiler both know.
 */

import { assertNever } from "../shared/brand";
import type { CountingBasis } from "../identity/subject";

export type AggregateFn = "sum" | "avg" | "min" | "max";

export type Measure =
  | { readonly kind: "count" }
  | { readonly kind: "distinct"; readonly basis: CountingBasis }
  | { readonly kind: "aggregate"; readonly fn: AggregateFn; readonly property: string };

export const Measure = {
  count: (): Measure => ({ kind: "count" }),
  distinctVisits: (): Measure => ({ kind: "distinct", basis: "visit" }),
  distinctPeople: (): Measure => ({ kind: "distinct", basis: "person" }),
  aggregate: (fn: AggregateFn, property: string): Measure => ({ kind: "aggregate", fn, property }),

  label: (m: Measure): string => {
    switch (m.kind) {
      case "count":
        return "Events";
      case "distinct":
        return m.basis === "person" ? "People" : "Visits";
      case "aggregate":
        return `${m.fn}(${m.property})`;
      default:
        return assertNever(m);
    }
  },

  /** Only aggregates read a property value, and only numerically. */
  isNumeric: (m: Measure): boolean => m.kind === "aggregate",

  /** True when the measure can only be answered on identified events. */
  requiresPerson: (m: Measure): boolean => m.kind === "distinct" && m.basis === "person",

  toKey: (m: Measure): string => {
    switch (m.kind) {
      case "count":
        return "count";
      case "distinct":
        return `distinct:${m.basis}`;
      case "aggregate":
        return `${m.fn}:${m.property}`;
      default:
        return assertNever(m);
    }
  },
} as const;
