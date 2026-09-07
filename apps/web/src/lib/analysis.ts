/**
 * The tile builder's one job: turn a handful of `<select>` values into an
 * `Analysis` the contract will accept.
 *
 * Every type here is projected out of `@counted/contract` rather than written
 * down. `Analysis` is a four-way discriminated union on `shape`, and the whole
 * point of building it in one place is that the four shapes carry different
 * fields — a series needs a `grain`, a breakdown needs a `by` and a `limit`,
 * and a scalar needs neither. A form that posts all of them and lets the server
 * sort it out is how v1 ended up with four vocabularies for one idea.
 *
 * Numbers are totals, lines are trends, and tables are breakdowns. Bars can
 * compare either time buckets or property values; choosing a dimension makes
 * that distinction explicit without changing what an existing tile measures.
 */

import type { ContractInputs, ContractOutputs } from "@counted/contract";

export type Analysis = ContractInputs["tiles"]["add"]["analysis"];
export type InsightView = ContractInputs["tiles"]["add"]["view"];

/**
 * The filter as the contract types it on the way *out*. On the way in, the
 * predicate schema is a `z.lazy` typed `ZodType<WirePredicate>`, whose input
 * type is `unknown` — true, and useless to build against. The output type is
 * the same shape and says what it is; it is assignable to the input either way.
 */
export type Predicate = NonNullable<
  Extract<
    ContractOutputs["dashboards"]["get"]["dashboard"]["tiles"][number]["analysis"],
    { shape: "scalar" }
  >["where"]
>;

/** The views the console can compose a question for. See `UNBUILDABLE_VIEWS`. */
export const BUILDABLE_VIEWS = ["number", "line", "bar", "table", "funnel"] as const;
export type BuildableView = (typeof BUILDABLE_VIEWS)[number];

/** Changing presentation must keep the tile's existing question meaningful. */
export const viewsFor = (shape: Analysis["shape"]): readonly InsightView[] => {
  switch (shape) {
    case "scalar":
      return ["number"];
    case "series":
      return ["line", "bar"];
    case "breakdown":
      return ["bar", "table"];
    case "funnel":
      return ["funnel"];
  }
};

/** Retention awaits a person-basis engine; a tile must never invent a result. */
export const UNBUILDABLE_VIEWS = ["retention"] as const;

export const MEASURES = [
  { value: "events", label: "Events" },
  { value: "visits", label: "Unique visits" },
  { value: "people", label: "Unique people" },
] as const;

export const WINDOW_UNITS = ["hour", "day", "week", "month"] as const;
export const GRAINS = ["hour", "day", "week", "month"] as const;

type Measure = Extract<Analysis, { shape: "scalar" }>["measure"];

/**
 * `measureFor`, `oneOf` and `eventPredicate` are exported for `monitors.ts`,
 * which builds the same scalar this form builds for a `number` tile but with
 * its own wording — a refusal that says "the tile" on a monitor form is a
 * refusal about the wrong thing. Sharing the pieces rather than `build` keeps
 * one spelling of what `events` and `visits` mean on the wire.
 */
export const measureFor = (raw: string): Measure | null => {
  if (raw === "events") return { kind: "count" };
  if (raw === "visits") return { kind: "unique", basis: "visit" };
  if (raw === "people") return { kind: "unique", basis: "person" };
  if (raw.startsWith("sum:") && raw.length > 4)
    return { kind: "sum", name: raw.slice(4) };
  return null;
};

export const oneOf = <T extends string>(
  options: readonly T[],
  raw: string,
): T | null =>
  (options as readonly string[]).includes(raw) ? (raw as T) : null;

export type Draft = {
  readonly view: string;
  readonly where?: Predicate | undefined;
  readonly original?: Analysis;
  readonly funnelSteps?: readonly { events: readonly string[]; label?: string; where?: Predicate }[] | undefined;
  readonly conversionMinutes?: number;
  readonly measure: string;
  /** Optional event-name restriction. */
  readonly event?: string | undefined;
  readonly events?: readonly string[];
  readonly windowAmount: number | null;
  readonly windowUnit: string;
  readonly grain: string;
  /** Required by `table`; present for a property-based `bar` chart. */
  readonly dimension: string | undefined;
  readonly dimensions?: readonly string[];
  readonly splitBy?: string | undefined;
  readonly seriesLimit?: number;
  readonly limit: number | null;
};

export type Built =
  | {
      readonly ok: true;
      readonly view: InsightView;
      readonly analysis: Analysis;
    }
  | { readonly ok: false; readonly problem: string };

/**
 * An event-name restriction is `eq(event_type, …)` and not a separate `events`
 * field. The contract's own schema comment says so, and v1 had both spellings
 * with two compilers behind them that disagreed about what an empty list meant.
 */
export const eventPredicate = (event: string): Predicate => ({
  op: "eq",
  field: { source: "dimension", key: "event_type" },
  value: event,
});

/** Multiple events are one union filter, so visits/people are not double-counted. */
export const eventsPredicate = (
  events: readonly string[],
): Predicate | undefined => {
  const values = [...new Set(events.filter((event) => event.length > 0))];
  if (values.length === 0) return undefined;
  if (values.length === 1) return eventPredicate(values[0]!);
  return {
    op: "in",
    field: { source: "dimension", key: "event_type" },
    values,
  };
};

/**
 * The bucket a window implies, chosen to land between about 7 and 100 points.
 *
 * Fewer than seven is a line with nothing to say; more than a hundred is a
 * line nobody can read at tile width. Overridable — the form still offers the
 * four grains — but never something a reader has to answer to get a chart.
 */
const grainFor = (window: {
  readonly amount: number;
  readonly unit: (typeof WINDOW_UNITS)[number];
}): (typeof GRAINS)[number] => {
  switch (window.unit) {
    case "hour":
      return "hour";
    case "day":
      return window.amount <= 2 ? "hour" : "day";
    case "week":
      return window.amount <= 6 ? "day" : "week";
    case "month":
      return window.amount <= 3 ? "day" : "week";
  }
};

export const build = (draft: Draft): Built => {
  const view = oneOf(BUILDABLE_VIEWS, draft.view);
  if (view === null)
    return { ok: false, problem: "Choose how the insight should be drawn." };

  const measure = measureFor(draft.measure);
  if (measure === null)
    return { ok: false, problem: "Choose what the insight should measure." };

  const unit = oneOf(WINDOW_UNITS, draft.windowUnit);
  if (unit === null) return { ok: false, problem: "Choose a window unit." };
  if (draft.windowAmount === null || !Number.isInteger(draft.windowAmount) || draft.windowAmount < 1) {
    return {
      ok: false,
      problem: "A window is a whole number of units, at least one.",
    };
  }

  // Relative, never resolved to absolute bounds here: a tile that says "the
  // last 7 days" has to still mean that tomorrow.
  const days = draft.windowAmount * ({hour: 1 / 24, day: 1, week: 7, month: 31}[unit]);
  if (days > 730) return { ok: false, problem: "Insights cover up to two years. Choose a shorter period." };
  if (view === "funnel" && days > 95) return { ok: false, problem: "A funnel covers up to 95 days." };
  const window = {
    kind: "relative",
    amount: draft.windowAmount,
    unit,
  } as const;
  if (view === "funnel") {
    const steps = draft.funnelSteps ?? [];
    if (steps.length !== 3 || steps.some((step) => step.events.length !== 1 || !step.events[0]?.trim()))
      return { ok: false, problem: "Choose one event for each of the three ordered steps." };
    const minutes = draft.conversionMinutes ?? 30;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
      return { ok: false, problem: "The conversion deadline is between 1 minute and 7 days." };
    return { ok: true, view, analysis: { shape: "funnel", funnel: {
      steps: steps.map((step) => ({ ...step, events: [...step.events] })), window,
      conversionWindowMs: minutes * 60_000, basis: "visit",
    } } };
  }
  const predicate = eventsPredicate(
    draft.events ?? (draft.event === undefined ? [] : [draft.event]),
  );
  const combined = [predicate, draft.where].filter((one): one is Predicate => one !== undefined);
  const where = combined.length === 0 ? {} : { where: combined.length === 1 ? combined[0]! : { op: "and" as const, operands: combined } };

  if (view === "number") {
    return {
      ok: true,
      view,
      analysis: {
        shape: "scalar",
        measure,
        window,
        summary: "total",
        ...where,
      },
    };
  }

  const dimensions =
    draft.dimensions ?? (draft.dimension ? [draft.dimension] : []);

  if (view === "line" || (view === "bar" && dimensions.length === 0)) {
    // Blank means "work it out". A bucket is a consequence of the window, not
    // an independent decision: a line over the last day wants hours and one
    // over the last year wants weeks, and asking every reader to say so is a
    // question with a right answer attached.
    const grain = oneOf(GRAINS, draft.grain) ?? grainFor(window);
    const limit = draft.seriesLimit ?? 3;
    if (draft.splitBy && (!Number.isInteger(limit) || limit < 1 || limit > 3))
      return { ok: false, problem: "A trend compares up to three groups." };
    return {
      ok: true,
      view,
      analysis: {
        shape: "series",
        measure,
        window,
        grain,
        ...where,
        ...(draft.splitBy
          ? { by: fieldFor(draft.splitBy), limit }
          : {}),
      },
    };
  }

  if (dimensions.length < 1 || dimensions.some((key) => !key.trim())) {
    return {
      ok: false,
      problem: "Choose a property to break down by.",
    };
  }
  if (dimensions.length > 3 || new Set(dimensions).size !== dimensions.length)
    return {
      ok: false,
      problem: "Choose up to three different breakdown properties.",
    };
  // The cap is a display bound, not a fan-out bound — the engine groups, so a
  // breakdown is one query whatever the limit. A hundred bars is still a table
  // nobody reads, and the contract refuses more.
  const limit = draft.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return {
      ok: false,
      problem: "A breakdown shows between 1 and 100 values.",
    };
  }
  return {
    ok: true,
    view,
    analysis: {
      shape: "breakdown",
      measure,
      window,
      by:
        dimensions.length === 1
          ? fieldFor(dimensions[0]!)
          : dimensions.map(fieldFor),
      order: "desc",
      limit,
      ...where,
    },
  };
};

/**
 * A title for a tile nobody named.
 *
 * Naming a tile before seeing it was the last question on every builder, and
 * the answer was always going to be what the tile shows. So say that:
 * "Unique visits, last 30 days" or "Events by country, last 30 days". A person
 * who wants something else renames it on the tile.
 */
export const titleFor = (d: Draft): string => {
  if (d.view === "funnel") return (d.funnelSteps?.map((step) => step.label || step.events.join(" or ")).join(" → ") || "Conversion funnel").slice(0, 200);
  const measure =
    MEASURES.find((one) => one.value === d.measure)?.label ??
    (d.measure.startsWith("sum:") ? `Sum of ${d.measure.slice(4)}` : "Events");
  const events = [
    ...new Set(
      (d.events ?? (d.event === undefined ? [] : [d.event])).filter(Boolean),
    ),
  ];
  const subject =
    events.length === 0
      ? measure
      : `${measure} · ${events.length === 1 ? events[0] : `${events.length} event types`}`;
  const dimensions = d.dimensions ?? (d.dimension ? [d.dimension] : []);
  const by =
    (d.view === "table" || d.view === "bar") && dimensions.length
      ? dimensions
      : d.splitBy
        ? [d.splitBy]
        : [];
  const sliced = by.length
    ? `${subject} by ${by.map((key) => fieldFor(key).key.replace(/_/g, " ")).join(" × ")}`
    : subject;
  const amount = d.windowAmount ?? 0;
  const window =
    amount > 0
      ? `, last ${amount} ${d.windowUnit}${amount === 1 ? "" : "s"}`
      : "";
  return `${sliced}${window}`.slice(0, 200);
};

/** Picker values preserve namespaces even when a property is named `country`. */
export const fieldFor = (value: string): { source: "dimension" | "property"; key: string } =>
  value.startsWith("property:") ? { source: "property", key: value.slice(9) } : { source: "dimension", key: value };
export const valueForField = (field: { source: "dimension" | "property"; key: string }): string =>
  field.source === "property" ? `property:${field.key}` : field.key;

/** Pull out only top-level event restrictions; all other predicates survive editing. */
export function draftFor(analysis: Analysis, view: InsightView): Draft {
  const window = analysis.shape === "funnel" ? analysis.funnel.window : analysis.window;
  const parts = analysis.shape === "funnel" || !analysis.where ? [] :
    (analysis.where as Predicate).op === "and" ? (analysis.where as Extract<Predicate, {op: "and" | "or"}>).operands : [analysis.where as Predicate];
  const events: string[] = [];
  const kept: Predicate[] = [];
  for (const part of parts) {
    if ("field" in part && part.field.source === "dimension" && part.field.key === "event_type" &&
      ((part.op === "eq" && typeof part.value === "string") || (part.op === "in" && part.values.every((one) => typeof one === "string"))) && !events.length)
      events.push(...(part.op === "eq" ? [part.value as string] : (part as Extract<Predicate, {op: "in" | "notIn"}>).values as string[]));
    else kept.push(part);
  }
  return {
    view, original: analysis, measure: analysis.shape === "funnel" || analysis.measure.kind === "count" ? "events" :
      analysis.measure.kind === "sum" ? `sum:${analysis.measure.name}` : analysis.measure.basis === "visit" ? "visits" : "people",
    events, ...(kept.length ? { where: kept.length === 1 ? kept[0]! : { op: "and", operands: kept } } : {}),
    windowAmount: window.kind === "relative" ? window.amount : 7, windowUnit: window.kind === "relative" ? window.unit : "day",
    grain: analysis.shape === "series" ? analysis.grain : "", dimension: undefined,
    dimensions: analysis.shape === "breakdown" ? ("source" in analysis.by ? [analysis.by] : analysis.by).map(valueForField) : [],
    splitBy: analysis.shape === "series" && analysis.by ? valueForField(analysis.by) : undefined,
    seriesLimit: analysis.shape === "series" ? analysis.limit ?? 3 : 3,
    limit: analysis.shape === "breakdown" ? analysis.limit : 10,
    ...(analysis.shape === "funnel" ? { funnelSteps: analysis.funnel.steps as Draft["funnelSteps"], conversionMinutes: analysis.funnel.conversionWindowMs / 60_000 } : {}),
  };
}
