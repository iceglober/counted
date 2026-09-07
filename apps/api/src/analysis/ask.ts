/**
 * Turning an `Analysis` into engine calls and the answers back into a readout.
 *
 * **This belongs in `@counted/analytics-app`, which is empty.** It is here
 * because `apps/api` is the only package that may see both the Analysis IR and
 * the engine port and still be written today; moving it is a file move and an
 * import change, and the seam it sits on — `Question` in, `Answer` out — is
 * already the shape that package would expose. Flagged in the hand-off rather
 * than hidden.
 *
 * Four properties this module is responsible for.
 *
 * **A relative window is resolved exactly once per request.** `now` is a
 * parameter, never a clock read, so twelve tiles on one dashboard cover the
 * same interval. v1 resolved per tile and two cards on one screen could
 * legitimately disagree by a bucket.
 *
 * **A failure never becomes a number.** Every path returns an `Answer` the
 * caller has to open. There is no `catch` that yields an empty series, which is
 * what v1's `Promise.allSettled(...).map(emptyData)` did — making a broken
 * query and a quiet project draw the same flat line.
 *
 * **A question the engine cannot serve is refused with the reason.** The domain
 * already classifies that (`Analysis.answerability`), so a planned-but-not-
 * collected dimension comes back as "not collected yet" and an unsupported
 * operator as "raw scan, which this engine has no builder for" — never as zero
 * rows.
 *
 * **A breakdown is one query.** It used to be `limit` of them — the values
 * came from `SchemaCatalog.dimensionValues` and each one got its own engine
 * call, because litics had no group-by. It has one now, so the engine returns
 * a row per value and `limit` is how many of them a caller wants rather than
 * how many round trips it pays for. Two things follow. A value nobody
 * predicted can no longer be missing from a chart, because the rows come from
 * the data instead of from a list fetched beforehand. And the number for a
 * unique breakdown is finally right: the sketches are unioned over the window
 * in SQL, where a fan-out summed thirty daily cardinalities and counted anyone
 * who came back twice.
 */

import {
  Duration,
  Instant,
  assertNever,
  type ProjectId,
  type Result,
} from "@counted/kernel";
import {
  Analysis,
  breakdownFields,
  MAX_SERIES_GROUPS,
  DEFAULT_CATALOG,
  DimensionCatalog,
  Funnel,
  Measure,
  SummaryStat,
  Window,
  describeBlocker,
  describeScanReason,
  resolveWindow,
  type AnalysisError,
  type ProjectSchema,
  type Predicate,
  type FieldRef,
} from "@counted/analytics-domain";
import type {
  AnalyticsEngine,
  Breakdown,
  BreakdownQuery,
  EngineFailure,
  EngineOutcome,
  EngineScope,
  Filters,
  SchemaCatalog,
  SeriesQuery,
  Series,
  Step,
} from "@counted/analytics-ports";
import { fromFunnelResult } from "./wire";

/**
 * The answer, shaped like the question — and shaped like the contract.
 *
 * The arrays are mutable rather than `readonly` because that is what
 * `AnsweredReadoutSchema` infers to, and a `readonly` array is not assignable
 * to a mutable one. Making the port's type match the wire's is cheaper than a
 * spread at every call site that would quietly copy an array per tile.
 */
export type ReadoutValue =
  | { shape: "scalar"; value: number }
  | {
      shape: "series";
      points: { bucketStart: string; value: number }[];
      series?: {
        key: string | null;
        label: string;
        points: { bucketStart: string; value: number }[];
      }[];
    }
  | {
      shape: "breakdown";
      dimensions?: { key: string; label: string }[];
      rows: { label: string; value: number; keys?: (string | null)[] }[];
    }
  | { shape: "funnel"; result: ReturnType<typeof fromFunnelResult> };

export type Answer =
  | {
      readonly ok: true;
      readonly value: ReadoutValue;
      readonly computedAt: Instant;
    }
  | { readonly ok: false; readonly failure: EngineFailure };

export type AskDeps = {
  readonly engine: AnalyticsEngine;
  readonly catalog: SchemaCatalog;
};

export type Question = {
  /** Which project's vocabulary and values the question is asked against. */
  readonly project: ProjectId;
  /**
   * Where the numbers come from — which may be the whole workspace, for a
   * dashboard tile whose analysis spans it. Separate from `project` because
   * the schema is a project's and the data may not be.
   */
  readonly scope: EngineScope;
  readonly analysis: Analysis;
  /** Read once by the caller, shared by every question in one request. */
  readonly now: Instant;
  readonly deadline: Duration;
  readonly traceId: string;
  readonly signal?: AbortSignal;
};

const failed = (failure: EngineFailure): Answer => ({ ok: false, failure });

const invalid = (detail: string): Answer =>
  failed({ kind: "InvalidQuery", detail });

/**
 * Read a project's declared vocabulary, so `Analysis.check` can be answered.
 *
 * Every dimension the catalog reports is treated as indexed — litics only
 * reports what it indexes — and the product's `planned`
 * dimensions are carried through from `DEFAULT_CATALOG` so `country` still
 * comes back as "not collected yet" rather than "no such field".
 */
export const readProjectSchema = async (
  deps: AskDeps,
  project: ProjectId,
): Promise<ProjectSchema> => {
  const [dimensions, measures] = await Promise.all([
    deps.catalog.dimensions(project),
    deps.catalog.measures(project),
  ]);
  return {
    dimensions: DimensionCatalog.of(dimensions, plannedFrom(dimensions)),
    measures: [...measures],
  };
};

/** The product's planned dimensions, minus any the project has actually indexed. */
const plannedFrom = (indexed: readonly string[]): readonly string[] =>
  DimensionCatalog.keys(DEFAULT_CATALOG).filter(
    (key) =>
      !indexed.includes(key) &&
      DimensionCatalog.status(DEFAULT_CATALOG, key) === "planned",
  );

const stepOf = (grain: "hour" | "day" | "week" | "month"): Step => grain;

/**
 * The engine query a metric analysis becomes, or the reason it cannot.
 *
 * `worst` has already folded the predicate's classification together with the
 * breakdown field's, so a single `unanswerable` here covers every cause and the
 * console can list all of them at once instead of one per round trip.
 */
type Planned =
  | {
      readonly ok: true;
      readonly event?: string | readonly string[];
      readonly filters: Filters;
      readonly predicate?: Predicate;
    }
  | { readonly ok: false; readonly answer: Answer };

const planFilters = (analysis: Analysis, schema: ProjectSchema): Planned => {
  const answerability = Analysis.answerability(analysis, schema.dimensions);
  switch (answerability.kind) {
    case "indexed":
      return {
        ok: true,
        ...(answerability.plan.event === undefined
          ? {}
          : { event: answerability.plan.event }),
        filters: answerability.plan.filters,
      };
    case "unanswerable":
      return {
        ok: false,
        answer: invalid(
          `this question cannot be answered: ${answerability.reasons.map(describeBlocker).join("; ")}`,
        ),
      };
    case "scan":
      return { ok: true, filters: {}, ...(Analysis.where(analysis) ? { predicate: Analysis.where(analysis)! } : {}) };
    default:
      return assertNever(answerability);
  }
};

const runSeries = async (
  deps: AskDeps,
  question: Question,
  measure: Measure,
  query: SeriesQuery,
): Promise<EngineOutcome<Series>> => {
  const options = {
    deadline: question.deadline,
    traceId: question.traceId,
    ...(question.signal === undefined ? {} : { signal: question.signal }),
  };
  switch (measure.kind) {
    case "count":
      return deps.engine.counts(query, options);
    case "unique":
      return deps.engine.uniques(query, options);
    case "sum":
      return deps.engine.sums({ ...query, measure: measure.name }, options);
    default:
      return assertNever(measure);
  }
};

const runBreakdown = async (
  deps: AskDeps,
  question: Question,
  measure: Measure,
  query: BreakdownQuery,
): Promise<EngineOutcome<Breakdown>> => {
  const options = {
    deadline: question.deadline,
    traceId: question.traceId,
    ...(question.signal === undefined ? {} : { signal: question.signal }),
  };
  switch (measure.kind) {
    case "count":
      return deps.engine.countsBy(query, options);
    case "unique":
      return deps.engine.uniquesBy(query, options);
    case "sum":
      return deps.engine.sumsBy({ ...query, measure: measure.name }, options);
    default:
      return assertNever(measure);
  }
};

/**
 * Answer one question.
 *
 * The analysis is validated against the project's schema first, because
 * "unknown dimension" is a better answer than an engine error about a column,
 * and because the check is free.
 */
export const ask = async (
  deps: AskDeps,
  question: Question,
  schema: ProjectSchema,
): Promise<Answer> => {
  const checked: Result<Analysis, AnalysisError> = Analysis.check(
    question.analysis,
    schema,
  );
  if (!checked.ok) return failed(fromAnalysisError(checked.error));

  const analysis = checked.value;
  if (Analysis.requiresPerson(analysis)) return invalid("Person-based analytics are not available yet. Choose unique visits or a visit funnel.");
  if (analysis.shape === "funnel")
    return askFunnel(deps, question, analysis.funnel);

  const planned = planFilters(analysis, schema);
  if (!planned.ok) return planned.answer;

  const bounds = resolveWindow(analysis.window, question.now);
  const base: SeriesQuery = {
    scope: question.scope,
    bounds,
    step: stepOf(
      analysis.shape === "series"
        ? analysis.grain
        : coarsest(analysis, question),
    ),
    ...(planned.event === undefined ? {} : { event: planned.event }),
    filters: planned.filters,
    ...(planned.predicate ? { predicate: planned.predicate } : {}),
  };

  switch (analysis.shape) {
    case "series": {
      if (analysis.by) return askSplitSeries(deps, question, analysis, base);
      const outcome = await runSeries(deps, question, analysis.measure, base);
      if (!outcome.ok) return failed(outcome.error);
      return {
        ok: true,
        computedAt: outcome.computedAt,
        value: {
          shape: "series",
          points: outcome.value.buckets.map((bucket) => ({
            bucketStart: Instant.toISO(bucket.start),
            value: bucket.value,
          })),
        },
      };
    }

    case "scalar": {
      const outcome = await runSeries(deps, question, analysis.measure, {
        ...base,
        ...(analysis.measure.kind === "unique" && analysis.summary === "total"
          ? { wholeWindow: true }
          : {}),
      });
      if (!outcome.ok) return failed(outcome.error);
      const collapsed = SummaryStat.apply(
        analysis.summary,
        outcome.value.buckets.map((bucket) => bucket.value),
      );
      if (collapsed === null) {
        // `SummaryStat.apply` returns null for every statistic but `total` on
        // an empty series, because the peak of nothing is not zero. A dense
        // series is never empty, so this means the window produced no buckets
        // at all — a bad window, not a quiet project.
        return invalid(
          `the window produced no buckets, so "${analysis.summary}" has no value`,
        );
      }
      return {
        ok: true,
        computedAt: outcome.computedAt,
        value: { shape: "scalar", value: collapsed },
      };
    }

    case "breakdown":
      return askBreakdown(deps, question, analysis, base);

    default:
      return assertNever(analysis);
  }
};

/** Rank once over the period, then keep those same groups in every time bucket. */
const askSplitSeries = async (
  deps: AskDeps,
  question: Question,
  analysis: Extract<Analysis, { shape: "series" }>,
  base: SeriesQuery,
): Promise<Answer> => {
  const started = performance.now();
  const budget = Duration.toMillis(question.deadline);
  const by = fieldKey(analysis.by!);
  const ranked = await runBreakdown(deps, question, analysis.measure, {
    ...base,
    by,
    order: "desc",
    limit: analysis.limit ?? MAX_SERIES_GROUPS,
  });
  if (!ranked.ok) return failed(ranked.error);
  if (ranked.value.rows.length === 0)
    return {
      ok: true,
      computedAt: ranked.computedAt,
      value: { shape: "series", points: [], series: [] },
    };
  const remaining = budget - (performance.now() - started);
  if (remaining <= 0)
    return failed({ kind: "Timeout", budget: question.deadline });
  const outcome = await runSeries(
    deps,
    {
      ...question,
      deadline: Duration.millis(Math.max(1, Math.floor(remaining))),
    },
    analysis.measure,
    { ...base, by },
  );
  if (!outcome.ok) return failed(outcome.error);
  if (!outcome.value.groups)
    return invalid("the engine did not return the requested trend groups");
  const groups = new Map(
    outcome.value.groups.map((group) => [group.key, group]),
  );
  if (ranked.value.rows.some((row) => !groups.has(row.key)))
    return failed({
      kind: "Unavailable",
      detail: "The trend groups changed while reading. Try again.",
    });
  return {
    ok: true,
    computedAt: outcome.computedAt,
    value: {
      shape: "series",
      points: [],
      series: ranked.value.rows.map((row) => ({
        key: row.key,
        label: row.key ?? UNSET_LABEL,
        points: (groups.get(row.key)?.buckets ?? []).map((bucket) => ({
          bucketStart: Instant.toISO(bucket.start),
          value: bucket.value,
        })),
      })),
    },
  };
};

/**
 * The step a scalar or breakdown is bucketed at.
 *
 * A scalar collapses the series, so the step only decides how many rows the
 * engine adds up — except for `average`, which is *per bucket* and therefore
 * changes the answer. The window's default grain is used so "average per day"
 * over a week means per day, rather than per whatever the engine happened to
 * route to.
 */
const coarsest = (
  analysis: Analysis,
  _question: Question,
): "hour" | "day" | "week" | "month" =>
  Window.defaultGrain(Analysis.window(analysis));

/**
 * The label a row with no value carries.
 *
 * The engine reports "the events in this group had no value for this
 * dimension" as a `null` key, and the wire's `BreakdownRow.label` is a string,
 * so something has to be written here. The row is kept rather than dropped
 * because dropping it makes the bars stop adding up to the total the same
 * question answers as a scalar, and nothing on the page would say why.
 */
export const UNSET_LABEL = "(not set)";

/**
 * A breakdown: one engine call, one row per value of the sliced dimension.
 *
 * Ranking and the limit are the engine's, not this function's — it is the only
 * layer that knows how many rows there were before the cut, and applying a
 * limit to something already truncated would be a second, silent one.
 *
 * No rows is a real answer — a breakdown over a dimension no event has carried
 * a value for — and not a failure. It is the case v1 could not distinguish.
 */
const askBreakdown = async (
  deps: AskDeps,
  question: Question,
  analysis: Extract<Analysis, { shape: "breakdown" }>,
  base: SeriesQuery,
): Promise<Answer> => {
  const outcome = await runBreakdown(deps, question, analysis.measure, {
    ...base,
    by:
      "source" in analysis.by
        ? fieldKey(analysis.by)
        : breakdownFields(analysis.by).map(fieldKey),
    order: analysis.order,
    limit: analysis.limit,
  });
  if (!outcome.ok) return failed(outcome.error);
  const fields = breakdownFields(analysis.by);
  if (
    fields.length > 1 &&
    outcome.value.rows.some((row) => row.keys?.length !== fields.length)
  )
    return invalid("the engine did not return every breakdown property");

  return {
    ok: true,
    computedAt: outcome.computedAt,
    value: {
      shape: "breakdown",
      dimensions: fields.map((field) => ({ key: field.key, label: field.key })),
      rows: outcome.value.rows.map((row) => ({
        label: row.keys
          ? row.keys.map((key) => key ?? UNSET_LABEL).join(" · ")
          : (row.key ?? UNSET_LABEL),
        value: row.value,
        ...(row.keys ? { keys: [...row.keys] } : {}),
      })),
    },
  };
};

/**
 * A funnel, if the engine's builder can take this shape.
 *
 * litics' builder is a three-tuple of bare event names. A funnel outside that
 * is refused with the reason rather than reduced to something the builder will
 * accept — reducing it is precisely what v1 did when it discarded per-step
 * filters, and the resulting chart was wrong without saying so.
 */
const askFunnel = async (
  deps: AskDeps,
  question: Question,
  funnel: Funnel,
): Promise<Answer> => {
  const answerability = Funnel.answerability(funnel);
  if (answerability.kind !== "indexed") {
    const reasons =
      answerability.kind === "unanswerable"
        ? answerability.reasons.map(describeBlocker)
        : answerability.reasons.map(describeScanReason);
    return invalid(`this funnel cannot be answered: ${reasons.join("; ")}`);
  }

  const steps = funnel.steps.map((step) => step.events[0] as string);
  const bounds = resolveWindow(funnel.window, question.now);

  const outcome = await deps.engine.funnel(
    {
      scope: question.scope,
      bounds,
      steps: [steps[0] as string, steps[1] as string, steps[2] as string],
      within: funnel.conversionWindow.within,
    },
    {
      deadline: question.deadline,
      traceId: question.traceId,
      ...(question.signal === undefined ? {} : { signal: question.signal }),
    },
  );
  if (!outcome.ok) return failed(outcome.error);

  const summarized = Funnel.summarize(funnel, [...outcome.value.counts]);
  if (!summarized.ok) {
    // The engine answered a different question than the one asked: counts that
    // rise between steps, or the wrong number of them. Reported as a fault of
    // ours (`Unavailable`) rather than of the request, because the funnel was
    // well-formed and there is nothing the caller can change.
    return failed({
      kind: "Unavailable",
      detail: `the engine returned inconsistent funnel counts: ${summarized.error.detail}`,
    });
  }

  return {
    ok: true,
    computedAt: outcome.computedAt,
    value: { shape: "funnel", result: fromFunnelResult(summarized.value) },
  };
};

/**
 * An analysis the project's schema refuses, in the engine's failure vocabulary.
 *
 * A dashboard carries these per tile in a 200 body, so they have to be
 * expressible as an `EngineFailure`; the single-question route re-maps them to
 * their own statuses through `fromAnalysisError` in `faults.ts`.
 */
export const fromAnalysisError = (error: AnalysisError): EngineFailure => {
  switch (error.kind) {
    case "InvalidAnalysis":
      return { kind: "InvalidQuery", detail: error.detail };
    case "WindowTooLarge":
      return {
        kind: "InvalidQuery",
        detail: `the window is longer than the maximum of ${error.max}ms`,
      };
    case "UnknownDimension":
      return {
        kind: "InvalidQuery",
        detail: `no such dimension: ${error.dimension}`,
      };
    case "UnknownMeasure":
      return {
        kind: "InvalidQuery",
        detail: `no such measure: ${error.measure}`,
      };
    default:
      return assertNever(error);
  }
};

const fieldKey = (field: FieldRef): string => field.source === "property" ? `property:${field.key}` : field.key;
