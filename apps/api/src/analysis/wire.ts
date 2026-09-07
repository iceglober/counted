/**
 * The Analysis IR, across the wire boundary, in both directions.
 *
 * `@counted/contract` restates the closed vocabularies — grain, summary, basis,
 * the sixteen predicate operators — as literal Zod enums, because the contract
 * is a leaf and may not import `@counted/analytics-domain`. This file is where
 * the two meet, and it is the reason that restatement is safe: every conversion
 * below is an exhaustive `switch` ending in `assertNever`, so a member added on
 * one side with no counterpart on the other is a compile error here rather than
 * a runtime surprise in a chart.
 *
 * One conversion is fallible and the rest are total. A wire `FieldRef` with
 * `source: "dimension"` carries an open string, because the wire cannot know
 * which dimensions exist; the domain's `DimensionName` is closed. A name that
 * is not one of ours is `UnknownDimension` — a stated 422 — and not silently
 * re-read as a customer property, which would answer a different question than
 * the one that was asked and draw a plausible chart from it.
 */

import {
  Duration,
  Instant,
  assertNever,
  err,
  isErr,
  ok,
  type Result,
} from "@counted/kernel";
import {
  Analysis,
  breakdownFields,
  ConversionWindow,
  FieldRef,
  Funnel,
  FunnelStep,
  isDimensionName,
  Measure,
  Predicate,
  Window,
  type AnalysisError,
  type FunnelResult,
  type Grain,
  type ScalarValue,
  type SortDirection,
  type SummaryStat,
} from "@counted/analytics-domain";
import type {
  AnalysisSchema,
  FunnelSchema,
  FunnelStepSchema,
  MeasureSchema,
  PredicateSchema,
  WindowSchema,
} from "@counted/contract";
import type * as z from "zod";

export type WireAnalysis = z.infer<typeof AnalysisSchema>;
export type WireWindow = z.infer<typeof WindowSchema>;
export type WireMeasure = z.infer<typeof MeasureSchema>;
export type WirePredicateValue = z.infer<typeof PredicateSchema>;
export type WireFunnel = z.infer<typeof FunnelSchema>;
export type WireFunnelStep = z.infer<typeof FunnelStepSchema>;

type Fallible<T> = Result<T, AnalysisError>;

// ── wire → domain ───────────────────────────────────────────────────────────

const toFieldRef = (wire: {
  source: "dimension" | "property";
  key: string;
}): Fallible<FieldRef> => {
  switch (wire.source) {
    case "dimension":
      return isDimensionName(wire.key)
        ? ok(FieldRef.dimension(wire.key))
        : err({ kind: "UnknownDimension", dimension: wire.key });
    case "property":
      return ok(FieldRef.property(wire.key));
    default:
      return assertNever(wire.source);
  }
};

export const toPredicate = (wire: WirePredicateValue): Fallible<Predicate> => {
  switch (wire.op) {
    case "and":
    case "or": {
      const operands: Predicate[] = [];
      for (const operand of wire.operands) {
        const converted = toPredicate(operand);
        if (isErr(converted)) return converted;
        operands.push(converted.value);
      }
      // Not `Predicate.and(...)`: that collapses a single operand, and an
      // `and` of one is a structural defect the domain's validator names. A
      // codec that quietly repaired it would hide a client bug.
      return ok({ op: wire.op, operands });
    }
    case "not": {
      const operand = toPredicate(wire.operand);
      return isErr(operand)
        ? operand
        : ok({ op: "not", operand: operand.value });
    }
    case "eq":
    case "neq": {
      const field = toFieldRef(wire.field);
      return isErr(field)
        ? field
        : ok({ op: wire.op, field: field.value, value: wire.value });
    }
    case "in":
    case "notIn": {
      const field = toFieldRef(wire.field);
      return isErr(field)
        ? field
        : ok({
            op: wire.op,
            field: field.value,
            values: wire.values as readonly ScalarValue[],
          });
    }
    case "contains":
    case "startsWith":
    case "endsWith": {
      const field = toFieldRef(wire.field);
      return isErr(field)
        ? field
        : ok({ op: wire.op, field: field.value, value: wire.value });
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const field = toFieldRef(wire.field);
      return isErr(field)
        ? field
        : ok({ op: wire.op, field: field.value, value: wire.value });
    }
    case "exists":
    case "notExists": {
      const field = toFieldRef(wire.field);
      return isErr(field) ? field : ok({ op: wire.op, field: field.value });
    }
    default:
      return assertNever(wire);
  }
};

export const toWindow = (wire: WireWindow): Fallible<Window> => {
  switch (wire.kind) {
    case "relative":
      return ok({ kind: "relative", amount: wire.amount, unit: wire.unit });
    case "absolute": {
      const from = Instant.fromISO(wire.from);
      if (isErr(from)) {
        return err({
          kind: "InvalidAnalysis",
          detail: `window.from is not an instant: ${wire.from}`,
        });
      }
      const to = Instant.fromISO(wire.to);
      if (isErr(to)) {
        return err({
          kind: "InvalidAnalysis",
          detail: `window.to is not an instant: ${wire.to}`,
        });
      }
      return ok(Window.between(from.value, to.value));
    }
    default:
      return assertNever(wire);
  }
};

const toMeasure = (wire: WireMeasure): Measure => {
  switch (wire.kind) {
    case "count":
      return Measure.count();
    case "unique":
      return { kind: "unique", basis: wire.basis };
    case "sum":
      return Measure.sum(wire.name);
    default:
      return assertNever(wire);
  }
};

const toFunnelStep = (wire: WireFunnelStep): Fallible<FunnelStep> => {
  if (wire.where === undefined) {
    return ok(FunnelStep.of(wire.events, undefined, wire.label));
  }
  const where = toPredicate(wire.where);
  return isErr(where)
    ? where
    : ok(FunnelStep.of(wire.events, where.value, wire.label));
};

const toFunnel = (wire: WireFunnel): Fallible<Funnel> => {
  const steps: FunnelStep[] = [];
  for (const step of wire.steps) {
    const converted = toFunnelStep(step);
    if (isErr(converted)) return converted;
    steps.push(converted.value);
  }
  const window = toWindow(wire.window);
  if (isErr(window)) return window;
  return ok(
    Funnel.of(
      steps,
      window.value,
      ConversionWindow.of(Duration.millis(wire.conversionWindowMs)),
      wire.basis,
    ),
  );
};

/**
 * Read an analysis off the wire.
 *
 * Structural validity is deliberately NOT checked here — `Analysis.validate`
 * and `Analysis.check` are separate calls the caller makes with the project's
 * schema in hand, because "is this well-formed" and "can this project answer
 * it" are different refusals with different fixes.
 */
export const toAnalysis = (wire: WireAnalysis): Fallible<Analysis> => {
  if (wire.shape === "funnel") {
    const funnel = toFunnel(wire.funnel);
    return isErr(funnel) ? funnel : ok(Analysis.ofFunnel(funnel.value));
  }

  const window = toWindow(wire.window);
  if (isErr(window)) return window;

  let where: Predicate | undefined;
  if (wire.where !== undefined) {
    const converted = toPredicate(wire.where);
    if (isErr(converted)) return converted;
    where = converted.value;
  }

  const measure = toMeasure(wire.measure);
  const common = {
    measure,
    window: window.value,
    ...(where === undefined ? {} : { where }),
  };

  switch (wire.shape) {
    case "scalar":
      return ok({
        ...common,
        shape: "scalar",
        summary: wire.summary as SummaryStat,
      });
    case "series": {
      const by = wire.by ? toFieldRef(wire.by) : undefined;
      if (by && isErr(by)) return by;
      return ok({
        ...common,
        shape: "series",
        grain: wire.grain as Grain,
        ...(by ? { by: by.value } : {}),
        ...(wire.limit === undefined ? {} : { limit: wire.limit }),
      });
    }
    case "breakdown": {
      const fields = Array.isArray(wire.by) ? wire.by : [wire.by];
      const by: FieldRef[] = [];
      for (const field of fields) {
        const converted = toFieldRef(field);
        if (isErr(converted)) return converted;
        by.push(converted.value);
      }
      return ok({
        ...common,
        shape: "breakdown",
        by: Array.isArray(wire.by) ? by : by[0]!,
        order: wire.order as SortDirection,
        limit: wire.limit,
      });
    }
    default:
      return assertNever(wire);
  }
};

// ── domain → wire ───────────────────────────────────────────────────────────

const fromFieldRef = (
  field: FieldRef,
): { source: "dimension" | "property"; key: string } => ({
  source: field.source,
  key: field.key,
});

export const fromPredicate = (predicate: Predicate): WirePredicateValue => {
  switch (predicate.op) {
    case "and":
    case "or":
      return {
        op: predicate.op,
        operands: predicate.operands.map(fromPredicate),
      };
    case "not":
      return { op: "not", operand: fromPredicate(predicate.operand) };
    case "eq":
    case "neq":
      return {
        op: predicate.op,
        field: fromFieldRef(predicate.field),
        value: predicate.value,
      };
    case "in":
    case "notIn":
      return {
        op: predicate.op,
        field: fromFieldRef(predicate.field),
        values: [...predicate.values],
      };
    case "contains":
    case "startsWith":
    case "endsWith":
      return {
        op: predicate.op,
        field: fromFieldRef(predicate.field),
        value: predicate.value,
      };
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return {
        op: predicate.op,
        field: fromFieldRef(predicate.field),
        value: predicate.value,
      };
    case "exists":
    case "notExists":
      return { op: predicate.op, field: fromFieldRef(predicate.field) };
    default:
      return assertNever(predicate);
  }
};

export const fromWindow = (window: Window): WireWindow => {
  switch (window.kind) {
    case "relative":
      return { kind: "relative", amount: window.amount, unit: window.unit };
    case "absolute":
      return {
        kind: "absolute",
        from: Instant.toISO(window.from),
        to: Instant.toISO(window.to),
      };
    default:
      return assertNever(window);
  }
};

const fromMeasure = (measure: Measure): WireMeasure => {
  switch (measure.kind) {
    case "count":
      return { kind: "count" };
    case "unique":
      return { kind: "unique", basis: measure.basis };
    case "sum":
      return { kind: "sum", name: measure.name };
    default:
      return assertNever(measure);
  }
};

const fromFunnelStep = (step: FunnelStep): WireFunnelStep => ({
  ...(step.label === undefined ? {} : { label: step.label }),
  events: [...step.events],
  ...(step.where === undefined ? {} : { where: fromPredicate(step.where) }),
});

export const fromAnalysis = (analysis: Analysis): WireAnalysis => {
  if (analysis.shape === "funnel") {
    return {
      shape: "funnel",
      funnel: {
        steps: analysis.funnel.steps.map(fromFunnelStep),
        window: fromWindow(analysis.funnel.window),
        conversionWindowMs: ConversionWindow.toMillis(
          analysis.funnel.conversionWindow,
        ),
        basis: analysis.funnel.basis,
      },
    };
  }

  const common = {
    measure: fromMeasure(analysis.measure),
    window: fromWindow(analysis.window),
    ...(analysis.where === undefined
      ? {}
      : { where: fromPredicate(analysis.where) }),
  };

  switch (analysis.shape) {
    case "scalar":
      return { ...common, shape: "scalar", summary: analysis.summary };
    case "series":
      return {
        ...common,
        shape: "series",
        grain: analysis.grain,
        ...(analysis.by ? { by: fromFieldRef(analysis.by) } : {}),
        ...(analysis.limit === undefined ? {} : { limit: analysis.limit }),
      };
    case "breakdown":
      return {
        ...common,
        shape: "breakdown",
        by:
          "source" in analysis.by
            ? fromFieldRef(analysis.by)
            : breakdownFields(analysis.by).map(fromFieldRef),
        order: analysis.order,
        limit: analysis.limit,
      };
    default:
      return assertNever(analysis);
  }
};

/** A funnel result, on the wire. Structurally identical; restated for the type. */
export const fromFunnelResult = (
  result: FunnelResult,
): {
  steps: {
    label: string;
    reached: number;
    rate: number;
    cumulativeRate: number;
    droppedOff: number;
  }[];
  overallRate: number;
} => ({
  steps: result.steps.map((step) => ({
    label: step.label,
    reached: step.reached,
    rate: step.rate,
    cumulativeRate: step.cumulativeRate,
    droppedOff: step.droppedOff,
  })),
  overallRate: result.overallRate,
});
