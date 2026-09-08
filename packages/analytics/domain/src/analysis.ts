/**
 * Analysis — the single serializable definition of a question.
 *
 * "What to measure, over what window, sliced how." One type, held by a
 * dashboard insight and by a monitor alike.
 *
 * v1 forked this four ways. Insights used a typed `InsightQuery`. Alerts used
 * `alerts.metric`, a free-text column with its own hand-rolled compiler
 * supporting a different subset of measures; `alerts.eventFilter`, a single
 * event name where insights took an array; and `alerts.window`, a string like
 * `"1h"` parsed by a regex that fell back to one hour on anything unfamiliar.
 * Four vocabularies for one idea, three of them undiscoverable. Insight presets
 * expand *into* this type; they never become a fifth.
 *
 * Two things are different from v2.
 *
 * There is no `events` field. An event restriction is a predicate on the
 * `event_type` dimension, which is why `event_type` is in the dimension set at
 * all. One filter language means one place to get filtering right.
 *
 * The shape of the *answer* is part of the definition rather than inferred from
 * whether a `groupBy` happens to be present. A monitor needs "this analysis
 * produces one number" to be a property it can check, not a guess from the
 * absence of a field.
 */

import { assertNever, Duration, err, ok, type Result } from "@counted/kernel";
import { classifyPredicate, worst, type Answerability } from "./answerability";
import { DimensionCatalog, EVENT_TYPE } from "./dimension";
import { describeDefects, type AnalysisDefect } from "./defect";
import { FieldRef } from "./field";
import { Funnel } from "./funnel";
import { Measure, type SummaryStat } from "./measure";
import { Predicate } from "./predicate";
import { Window, MAX_WINDOW, type Grain } from "./window";

export type SortDirection = "asc" | "desc";

/** The shape of the answer, which is also the shape of the chart. */
export type ReadoutShape = "scalar" | "series" | "breakdown" | "funnel";

type MetricCommon = {
  readonly measure: Measure;
  readonly where?: Predicate;
  readonly window: Window;
};

export type Analysis =
  /** One number. What a monitor evaluates and a total insight renders. */
  | (MetricCommon & { readonly shape: "scalar"; readonly summary: SummaryStat })
  /** A number per bucket, optionally split by a field. Grain is explicit. */
  | (MetricCommon & {
      readonly shape: "series";
      readonly grain: Grain;
      readonly by?: FieldRef;
      readonly limit?: number;
    })
  /** A number per value or tuple of up to three fields, ordered and capped. */
  | (MetricCommon & {
      readonly shape: "breakdown";
      readonly by: FieldRef | readonly FieldRef[];
      readonly order: SortDirection;
      readonly limit: number;
    })
  | { readonly shape: "funnel"; readonly funnel: Funnel };

/**
 * The four error kinds V3-SPEC §6 maps onto the wire. Structural detail lives
 * in `AnalysisDefect` and is flattened into `InvalidAnalysis.detail` here.
 */
export type AnalysisError =
  | { readonly kind: "InvalidAnalysis"; readonly detail: string }
  | { readonly kind: "WindowTooLarge"; readonly max: number }
  | { readonly kind: "UnknownDimension"; readonly dimension: string }
  | { readonly kind: "UnknownMeasure"; readonly measure: string };

export const MAX_BREAKDOWN_LIMIT = 100;
export const MAX_BREAKDOWN_FIELDS = 3;
export const MAX_SERIES_GROUPS = 3;

/** Old one-field analyses remain valid; new breakdowns may name a tuple. */
export const breakdownFields = (
  by: FieldRef | readonly FieldRef[],
): readonly FieldRef[] => ("source" in by ? [by] : by);

const groupedFields = (a: Analysis): readonly FieldRef[] =>
  a.shape === "breakdown"
    ? breakdownFields(a.by)
    : a.shape === "series" && a.by
      ? [a.by]
      : [];

/**
 * The declared vocabulary a project's events actually have.
 *
 * A value, passed in. The domain cannot ask a database what a project has seen,
 * so the application reads `SchemaCatalog` once and hands the answer down.
 */
export type ProjectSchema = {
  readonly dimensions: DimensionCatalog;
  readonly measures: readonly string[];
};

export const Analysis = {
  /** The simplest useful question: how many events, over this window. */
  countOverWindow: (
    window: Window,
    summary: SummaryStat = "total",
  ): Analysis => ({
    shape: "scalar",
    measure: Measure.count(),
    window,
    summary,
  }),

  timeSeries: (measure: Measure, window: Window, grain?: Grain): Analysis => ({
    shape: "series",
    measure,
    window,
    grain: grain ?? Window.defaultGrain(window),
  }),

  breakdown: (
    measure: Measure,
    by: FieldRef | readonly FieldRef[],
    window: Window,
    limit = 10,
  ): Analysis => ({
    shape: "breakdown",
    measure,
    window,
    by,
    order: "desc",
    limit,
  }),

  ofFunnel: (funnel: Funnel): Analysis => ({ shape: "funnel", funnel }),

  isScalar: (a: Analysis): boolean => a.shape === "scalar",

  readoutShape: (a: Analysis): ReadoutShape => a.shape,

  window: (a: Analysis): Window =>
    a.shape === "funnel" ? a.funnel.window : a.window,

  where: (a: Analysis): Predicate | undefined =>
    a.shape === "funnel" ? undefined : a.where,

  /**
   * Rebase onto a different window, keeping everything else.
   *
   * This is how a dashboard's range picker works without an insight storing a
   * second copy of the question, and how a trend re-runs the same question over
   * the prior period.
   */
  withWindow: (a: Analysis, window: Window): Analysis =>
    a.shape === "funnel"
      ? { shape: "funnel", funnel: { ...a.funnel, window } }
      : { ...a, window },

  /** True when the analysis can only be answered on identified events. */
  requiresPerson: (a: Analysis): boolean =>
    a.shape === "funnel"
      ? Funnel.requiresPerson(a.funnel)
      : Measure.requiresPerson(a.measure),

  /** True when the number that comes back is an estimate, not a count. */
  isApproximate: (a: Analysis): boolean =>
    a.shape !== "funnel" && Measure.isApproximate(a.measure),

  /** Every field the analysis mentions, deduplicated. */
  fields: (a: Analysis): readonly FieldRef[] => {
    const refs: FieldRef[] = [];
    if (a.shape === "funnel") {
      refs.push(FieldRef.dimension(EVENT_TYPE));
      for (const step of a.funnel.steps) {
        if (step.where !== undefined)
          refs.push(...Predicate.fields(step.where));
      }
    } else {
      if (a.where !== undefined) refs.push(...Predicate.fields(a.where));
      refs.push(...groupedFields(a));
    }
    const seen = new Set<string>();
    return refs.filter((f) => {
      const key = FieldRef.toKey(f);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  /**
   * A stable key for the whole question, so two insights asking the same thing are
   * coalesced into one execution. v1 ran identical queries twice within a
   * single dashboard load because nothing compared them.
   */
  toKey: (a: Analysis): string => {
    if (a.shape === "funnel") {
      return `funnel;${Funnel.toKey(a.funnel)};wn:${Window.toKey(a.funnel.window)}`;
    }
    const head = [
      a.shape,
      Measure.toKey(a.measure),
      `wh:${a.where === undefined ? "" : Predicate.toKey(a.where)}`,
      `wn:${Window.toKey(a.window)}`,
    ];
    switch (a.shape) {
      case "scalar":
        return [...head, `sm:${a.summary}`].join(";");
      case "series":
        return [
          ...head,
          `gr:${a.grain}`,
          ...(a.by
            ? [
                `by:${breakdownFields(a.by).map(FieldRef.toKey).join(",")}`,
                `li:${a.limit ?? MAX_SERIES_GROUPS}`,
              ]
            : []),
        ].join(";");
      case "breakdown":
        return [
          ...head,
          `by:${breakdownFields(a.by).map(FieldRef.toKey).join(",")}`,
          `or:${a.order}`,
          `li:${a.limit}`,
        ].join(";");
      default:
        return assertNever(a);
    }
  },

  /**
   * Every structural problem, all at once.
   *
   * Structural means "the question is well-formed" — not "the data can answer
   * it". Whether the fields exist is `Analysis.check`; whether the engine can
   * serve it cheaply is `Analysis.answerability`. Three different questions,
   * three different answers, because conflating them is how a missing dimension
   * and a slow filter end up looking the same on screen.
   */
  defects: (a: Analysis): readonly AnalysisDefect[] => {
    const out: AnalysisDefect[] = [];

    if (a.shape === "funnel") {
      out.push(...Funnel.defects(a.funnel));
      for (const step of a.funnel.steps) {
        if (step.where !== undefined) out.push(...predicateDefects(step.where));
      }
      out.push(...windowDefects(a.funnel.window));
      return out;
    }

    if (a.measure.kind === "sum" && a.measure.name.trim().length === 0) {
      out.push({ kind: "EmptyMeasureName" });
    }
    if (a.where !== undefined) out.push(...predicateDefects(a.where));
    const groups = groupedFields(a);
    if (
      a.shape === "breakdown" &&
      (groups.length < 1 || groups.length > MAX_BREAKDOWN_FIELDS)
    ) {
      out.push({
        kind: "InvalidGrouping",
        detail: "a breakdown needs one to three properties",
      });
    }
    if (new Set(groups.map(FieldRef.toKey)).size !== groups.length) {
      out.push({
        kind: "InvalidGrouping",
        detail: "a property cannot be grouped twice",
      });
    }
    for (const field of groups) {
      if (!field.key.trim()) out.push({ kind: "EmptyPropertyKey" });
    }
    if (
      a.shape === "breakdown" ||
      (a.shape === "series" && a.limit !== undefined)
    ) {
      const limit = a.limit ?? MAX_SERIES_GROUPS;
      const max =
        a.shape === "breakdown" ? MAX_BREAKDOWN_LIMIT : MAX_SERIES_GROUPS;
      if (!Number.isInteger(limit) || limit < 1 || limit > max)
        out.push({ kind: "LimitOutOfRange", limit, max });
      if (a.shape === "series" && !a.by)
        out.push({
          kind: "InvalidGrouping",
          detail: "a series limit requires a split property",
        });
    }
    out.push(...windowDefects(a.window));
    return out;
  },

  /**
   * Structural validity plus the window ceiling. Does not need a schema.
   */
  validate: (a: Analysis): Result<Analysis, AnalysisError> => {
    const defects = Analysis.defects(a);
    if (defects.length > 0) {
      return err({ kind: "InvalidAnalysis", detail: describeDefects(defects) });
    }
    const span = Duration.toMillis(Window.maximumSpan(Analysis.window(a)));
    if (span > Duration.toMillis(MAX_WINDOW)) {
      return err({
        kind: "WindowTooLarge",
        max: Duration.toMillis(MAX_WINDOW),
      });
    }
    return ok(a);
  },

  /**
   * Validity against what a project actually has: every field it filters or
   * slices by is a dimension the project knows, and every measure it sums is
   * one the project declares.
   *
   * A `planned` dimension passes here — it is a known name — and is caught by
   * `answerability` as `DimensionNotCollected`. The two failures read
   * differently to a person ("no such field" versus "not collected yet") and
   * they should.
   */
  check: (
    a: Analysis,
    schema: ProjectSchema,
  ): Result<Analysis, AnalysisError> => {
    const structural = Analysis.validate(a);
    if (!structural.ok) return structural;

    for (const field of Analysis.fields(a)) {
      if (field.source === "property" && field.key.startsWith("$")) return err({ kind: "InvalidAnalysis", detail: "Reserved event metadata cannot be queried as a custom property." });
      if (field.source !== "property" && DimensionCatalog.status(schema.dimensions, field.key) === "unknown") {
        return err({ kind: "UnknownDimension", dimension: field.key });
      }
    }
    if (a.shape !== "funnel") {
      const name = Measure.readsMeasure(a.measure);
      if (name !== null && !schema.measures.includes(name)) {
        return err({ kind: "UnknownMeasure", measure: name });
      }
    }
    return ok(a);
  },

  /**
   * How, and how expensively, the engine can answer this.
   *
   * A breakdown is the interesting case, and it changed. It used to cost one
   * query per value of the sliced field, because the engine had no group-by —
   * so `limit` was a fan-out bound rather than a display preference. litics
   * groups over the indexed dimension columns now, so a breakdown is ONE read and
   * `limit` is how many rows the caller wants back.
   *
   * The condition is unchanged and is the thing to keep hold of: only a
   * dimension the index carries can be split on. The index stores one row per
   * combination of the dimensions it was built with, so a dimension it lacks
   * was summed away when the row was written — there is no query, cheap or
   * expensive, that recovers it. That is why a `planned` field is
   * `unanswerable` here and an undeclared one is a `scan`.
   */
  answerability: (a: Analysis, catalog: DimensionCatalog): Answerability => {
    if (a.shape === "funnel") {
      const steps = a.funnel.steps.map((s) =>
        classifyPredicate(s.where, catalog),
      );
      return worst([Funnel.answerability(a.funnel), ...steps]);
    }

    const base = classifyPredicate(a.where, catalog);
    const groups = groupedFields(a);
    const availability: Answerability[] = [base];
    for (const field of groups) {
      const status = DimensionCatalog.status(catalog, field.key);
      if (status === "planned")
        availability.push({
          kind: "unanswerable",
          reasons: [{ kind: "DimensionNotCollected", key: field.key }],
        });
      else if (status === "unknown" || status === "scanned" || field.source === "property")
        availability.push({
          kind: "scan",
          reasons: [
            FieldRef.isShadowed(field)
              ? { kind: "ShadowedDimension", key: field.key }
              : { kind: "UndeclaredDimension", key: field.key },
          ],
        });
    }
    const result = worst(availability);
    if (result.kind !== "indexed") return result;
    return { ...result, queries: a.shape === "series" && a.by ? 2 : 1 };
  },
} as const;

const windowDefects = (w: Window): readonly AnalysisDefect[] => {
  if (w.kind === "relative" && w.amount <= 0) {
    return [{ kind: "NonPositiveWindow", amount: w.amount }];
  }
  if (w.kind === "absolute" && w.to <= w.from)
    return [{ kind: "InvertedWindow" }];
  return [];
};

const predicateDefects = (p: Predicate): readonly AnalysisDefect[] => {
  const out: AnalysisDefect[] = [];
  const walk = (node: Predicate): void => {
    switch (node.op) {
      case "and":
      case "or":
        if (node.operands.length === 0)
          out.push({ kind: "EmptyPredicateGroup", op: node.op });
        for (const operand of node.operands) walk(operand);
        return;
      case "not":
        walk(node.operand);
        return;
      case "in":
      case "notIn":
        if (node.values.length === 0)
          out.push({ kind: "EmptyValueList", op: node.op });
        return;
      default:
        return;
    }
  };
  walk(p);
  for (const field of Predicate.fields(p)) {
    if (field.source === "property" && field.key.trim().length === 0) {
      out.push({ kind: "EmptyPropertyKey" });
    }
  }
  return out;
};
