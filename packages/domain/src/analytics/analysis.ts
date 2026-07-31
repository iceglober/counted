/**
 * Analysis — the single serializable definition of a question.
 *
 * "What to measure, over whom, when, sliced how." One type, used by dashboard
 * tiles and by monitors alike.
 *
 * v1 forked this four ways. Insights used a typed `InsightQuery`. Alerts used
 * `alerts.metric`, a free-text column with its own hand-rolled compiler
 * supporting a different subset of measures; `alerts.eventFilter`, a single
 * event name where insights took an array; and `alerts.window`, a string like
 * `"1h"` parsed by a regex that fell back to one hour on anything unfamiliar.
 * Four vocabularies for one idea, three of them undiscoverable.
 *
 * Presets (#27's tile templates) expand *into* this type. They never become a
 * parallel vocabulary, because there is nothing to parallel — an Analysis is
 * the only way to express a question.
 */

import { err, ok, type Result } from "../shared/result";
import { FieldRef } from "./field";
import { Measure } from "./measure";
import { Predicate } from "./predicate";
import { Grain, Window } from "./window";

export type SortDirection = "asc" | "desc";

/** Slice the result: by a field, or across time. */
export type Dimension =
  | { readonly by: "field"; readonly field: FieldRef }
  | { readonly by: "time"; readonly grain: Grain };

export const Dimension = {
  field: (field: FieldRef): Dimension => ({ by: "field", field }),
  time: (grain: Grain): Dimension => ({ by: "time", grain }),
  isTime: (d: Dimension): boolean => d.by === "time",
} as const;

export type Analysis = {
  readonly measure: Measure;
  /** Restrict to these event names. Empty or absent means all events. */
  readonly events?: readonly string[];
  readonly where?: Predicate;
  readonly groupBy?: readonly Dimension[];
  readonly window: Window;
  /** Applies to the leading field dimension. Time always sorts ascending. */
  readonly orderBy?: SortDirection;
  /** Cap on returned groups. Absent means the executor's default applies. */
  readonly limit?: number;
};

export type AnalysisError =
  | { kind: "EmptyEventName" }
  | { kind: "EmptyPropertyKey" }
  | { kind: "AggregatePropertyRequired" }
  | { kind: "MultipleTimeDimensions"; count: number }
  | { kind: "EmptyPredicateGroup"; op: "and" | "or" }
  | { kind: "EmptyValueList"; op: "in" | "notIn" }
  | { kind: "LimitOutOfRange"; limit: number }
  | { kind: "NonPositiveWindow"; amount: number }
  | { kind: "InvertedWindow" };

export const MAX_LIMIT = 1_000;

export const Analysis = {
  /** The simplest useful question: how many events, over this window. */
  countOverWindow: (window: Window): Analysis => ({ measure: Measure.count(), window }),

  timeSeries: (measure: Measure, window: Window, grain?: Grain): Analysis => ({
    measure,
    window,
    groupBy: [Dimension.time(grain ?? Window.defaultGrain(window))],
  }),

  breakdown: (measure: Measure, field: FieldRef, window: Window, limit = 10): Analysis => ({
    measure,
    window,
    groupBy: [Dimension.field(field)],
    orderBy: "desc",
    limit,
  }),

  /**
   * Rebase onto a different window, keeping everything else. This is how a
   * dashboard's range picker works without a tile storing a second copy of the
   * question, and how a trend re-runs the same question over the prior period.
   */
  withWindow: (a: Analysis, window: Window): Analysis => ({ ...a, window }),

  timeDimension: (a: Analysis): Dimension | undefined =>
    (a.groupBy ?? []).find(Dimension.isTime),

  fieldDimensions: (a: Analysis): readonly Dimension[] =>
    (a.groupBy ?? []).filter((d) => !Dimension.isTime(d)),

  /** True when this analysis can only be answered on identified events. */
  requiresPerson: (a: Analysis): boolean => Measure.requiresPerson(a.measure),

  /**
   * A stable key for the whole question, so two tiles asking the same thing
   * can be coalesced into one execution. v1 ran identical queries twice within
   * a single dashboard load because nothing compared them.
   */
  toKey: (a: Analysis): string => {
    const parts = [
      Measure.toKey(a.measure),
      `ev:${[...(a.events ?? [])].sort().join(",")}`,
      `wh:${a.where === undefined ? "" : JSON.stringify(a.where)}`,
      `by:${(a.groupBy ?? [])
        .map((d) => (d.by === "time" ? `t:${d.grain}` : `f:${FieldRef.toKey(d.field)}`))
        .join("|")}`,
      `wn:${Window.toKey(a.window)}`,
      `or:${a.orderBy ?? ""}`,
      `li:${a.limit ?? ""}`,
    ];
    return parts.join(";");
  },

  /**
   * Structural validity. This is about the question being well-formed, not
   * about whether the data can answer it — an executor still checks fields
   * against the project's schema.
   */
  validate: (a: Analysis): Result<Analysis, AnalysisError> => {
    if (a.measure.kind === "aggregate" && a.measure.property.trim().length === 0) {
      return err({ kind: "AggregatePropertyRequired" });
    }

    for (const name of a.events ?? []) {
      if (name.trim().length === 0) return err({ kind: "EmptyEventName" });
    }

    if (a.where !== undefined) {
      const bad = validatePredicate(a.where);
      if (bad !== null) return err(bad);
      for (const f of Predicate.fields(a.where)) {
        if (f.source === "property" && f.key.trim().length === 0) {
          return err({ kind: "EmptyPropertyKey" });
        }
      }
    }

    for (const d of a.groupBy ?? []) {
      if (d.by === "field" && d.field.source === "property" && d.field.key.trim().length === 0) {
        return err({ kind: "EmptyPropertyKey" });
      }
    }

    const timeDims = (a.groupBy ?? []).filter(Dimension.isTime).length;
    if (timeDims > 1) return err({ kind: "MultipleTimeDimensions", count: timeDims });

    if (a.limit !== undefined && (a.limit <= 0 || a.limit > MAX_LIMIT)) {
      return err({ kind: "LimitOutOfRange", limit: a.limit });
    }

    if (a.window.kind === "relative" && a.window.amount <= 0) {
      return err({ kind: "NonPositiveWindow", amount: a.window.amount });
    }
    if (a.window.kind === "absolute" && a.window.to <= a.window.from) {
      return err({ kind: "InvertedWindow" });
    }

    return ok(a);
  },
} as const;

const validatePredicate = (p: Predicate): AnalysisError | null => {
  switch (p.op) {
    case "and":
    case "or": {
      if (p.operands.length === 0) return { kind: "EmptyPredicateGroup", op: p.op };
      for (const operand of p.operands) {
        const bad = validatePredicate(operand);
        if (bad !== null) return bad;
      }
      return null;
    }
    case "not":
      return validatePredicate(p.operand);
    case "in":
    case "notIn":
      return p.values.length === 0 ? { kind: "EmptyValueList", op: p.op } : null;
    default:
      return null;
  }
};
