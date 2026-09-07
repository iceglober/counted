/**
 * Turning an engine query into litics reads — or into a refusal that says why.
 *
 * Four refusals happen here rather than in the engine, and each one exists
 * because the alternative is a chart that looks fine and is wrong.
 *
 * **A filter on a column no segment carries is refused, not "slowed down".**
 * litics reads summaries for the interior of a window and decodes segments
 * at its edges; both know only the declared dimensions. A customer property
 * lives in `props`, which the engine does not filter on, so the
 * classification `@counted/analytics-domain` exports is used for what it is
 * good at: naming the cause. A planned dimension comes back as "not collected
 * yet", a customer property as "not a declared dimension", and neither comes
 * back as an empty series.
 *
 * **A window that outlives retention is refused.** Segments older than
 * `SEGMENT_RETENTION_DAYS` are deleted by the compactor. Ask over three years
 * and the read succeeds, returns two, and draws a chart that appears to show
 * traffic starting one spring. Comparing the window against retention turns
 * that into a sentence.
 *
 * **A funnel longer than `FUNNEL_MAX_DAYS` is refused.** A funnel decodes
 * every segment in its window and sorts the step events in memory. That is
 * cheap over a quarter and not over two years, and the ceiling is stated
 * rather than discovered under load.
 *
 * **A breakdown by a dimension no segment carries is refused.** Same fact as
 * the filter, same sentences.
 */

import type {
  FunnelQuery as LiticsFunnelQuery,
  RangeQuery,
} from "@litics/core";
import {
  Answerability,
  classifyPredicate,
  DimensionCatalog,
  FieldRef,
  Predicate,
} from "@counted/analytics-domain";
import type {
  Bounds,
  BreakdownQuery,
  EngineFailure,
  EngineScope,
  Filters,
  FunnelQuery,
  SeriesQuery,
  SortDirection,
  Step,
  SumsQuery,
} from "@counted/analytics-ports";
import { Duration, Instant, unbrand } from "@counted/kernel";

import {
  gridStarts,
  MAX_BUCKETS,
  monthSpans,
  stepInterval,
  wholeWindowStride,
} from "./bucketing";
import {
  INDEXED_DIMENSIONS,
  DECLARED_MEASURES,
  FUNNEL_MAX_DAYS,
  PLANNED_DIMENSIONS,
  SEGMENT_RETENTION_DAYS,
} from "./config";

export type Refusal = { readonly ok: false; readonly error: EngineFailure };
export type Planned<T> = { readonly ok: true; readonly plan: T } | Refusal;

const refuse = (detail: string): Refusal => ({
  ok: false,
  error: { kind: "InvalidQuery", detail },
});

/** One litics read to run. */
export type RangeCall = { readonly query: RangeQuery };

/**
 * How a series is assembled.
 *
 * `starts` is the dense grid the answer must have one bucket for. `calls` is
 * usually one read; it is one per calendar month only where the values
 * cannot be added up client-side.
 */
export type SeriesPlan = {
  readonly step: Step;
  readonly starts: readonly Instant[];
  readonly calls: readonly RangeCall[];
  readonly by?: string;
};

/** The catalog the domain classifier judges a filter against. */
const catalog = DimensionCatalog.of(INDEXED_DIMENSIONS, PLANNED_DIMENSIONS);

/**
 * The scope value litics binds: a workspace or a project id, either of which is
 * a row in the org table, so the closure table resolves the subtree.
 */
const scopeValue = (scope: EngineScope): string =>
  scope.level === "workspace"
    ? unbrand(scope.workspace)
    : unbrand(scope.project);

/**
 * Flatten `event` and `filters` into the one dimension map litics takes, and
 * make the domain say whether it can be served.
 *
 * `event` is folded in as `event_type` rather than kept apart, because that is
 * what it is: the analytics domain models an event restriction as a predicate
 * on the `event_type` dimension precisely so there is one filter language.
 */
export const planFilters = (
  event: string | readonly string[] | undefined,
  filters: Filters | undefined,
): Planned<Readonly<Record<string, string | readonly string[]>>> => {
  const leaves = Object.entries(filters ?? {}).map(([key, value]) =>
    Predicate.eq(FieldRef.parse(key), value),
  );
  if (event !== undefined) {
    if (Array.isArray(event) && event.length === 0)
      return { ok: true, plan: { ...filters, event_type: [] } };
    leaves.unshift(
      typeof event === "string"
        ? Predicate.eq(FieldRef.dimension("event_type"), event)
        : Predicate.in(FieldRef.dimension("event_type"), event),
    );
  }
  if (leaves.length === 0) return { ok: true, plan: {} };

  const answerability = classifyPredicate(Predicate.and(...leaves), catalog);
  if (answerability.kind !== "indexed") {
    return refuse(Answerability.describe(answerability));
  }
  const { plan } = answerability;
  return {
    ok: true,
    plan:
      plan.event === undefined
        ? plan.filters
        : { ...plan.filters, event_type: plan.event },
  };
};

/** Why this deployment cannot sum that measure, or null if it can. */
const undeclaredMeasure = (measure: string | undefined): string | null => {
  if (measure === undefined || DECLARED_MEASURES.includes(measure)) return null;
  return DECLARED_MEASURES.length === 0
    ? `no numeric measure is declared on this deployment, so "${measure}" cannot be summed; ` +
        `measures are additive facts carried on every event and Counted collects none yet`
    : `"${measure}" is not a declared measure; declared: ${DECLARED_MEASURES.join(", ")}`;
};

const boundsProblem = (bounds: Bounds): string | null => {
  if (!Number.isFinite(Instant.toEpochMillis(bounds.from)))
    return "the window start is not a time";
  if (!Number.isFinite(Instant.toEpochMillis(bounds.to)))
    return "the window end is not a time";
  if (Instant.toEpochMillis(bounds.to) <= Instant.toEpochMillis(bounds.from)) {
    return "the window ends at or before it starts";
  }
  return null;
};

/**
 * Whether the window is inside what the compactor still keeps.
 *
 * Retention is the only reach check now. There is no cube to route to: the
 * engine answers every step from summaries and segments, and a fifteen-minute
 * grid over a year is a slower read, not a refused one.
 */
const reach = (
  from: Instant,
  query: RangeQuery,
  now: Instant,
): Planned<RangeCall> => {
  const earliest = Instant.minus(now, Duration.days(SEGMENT_RETENTION_DAYS));
  if (Instant.isBefore(from, earliest)) {
    return refuse(
      `events are kept ${SEGMENT_RETENTION_DAYS} days and the window starts before that; ask over a shorter window`,
    );
  }
  return { ok: true, plan: { query } };
};

/**
 * Plan a counts/uniques/sums series.
 *
 * `additive` says whether per-bucket values may be added up in this process.
 * Counts and measure sums are; a unique count is not — the actor sets are
 * merged inside one engine read, never across two. That single flag is the
 * whole difference between a monthly count (one daily-step read, folded here)
 * and monthly uniques (one read per calendar month).
 */
const planSeriesBase = (
  query: SeriesQuery,
  now: Instant,
  options: { readonly additive: boolean; readonly measure?: string },
): Planned<SeriesPlan> => {
  const problem = boundsProblem(query.bounds);
  if (problem !== null) return refuse(problem);

  const measureProblem = undeclaredMeasure(options.measure);
  if (measureProblem !== null) return refuse(measureProblem);

  const filters = planFilters(query.event, query.filters);
  if (!filters.ok) return filters;

  const starts = gridStarts(query.bounds.from, query.bounds.to, query.step);
  if (starts.length > MAX_BUCKETS) {
    return refuse(
      `that window at ${query.step} granularity is ${starts.length} buckets, over the ${MAX_BUCKETS} limit`,
    );
  }
  if (starts.length === 0)
    return { ok: true, plan: { step: query.step, starts, calls: [] } };

  const scope = scopeValue(query.scope);
  const first = starts[0] as Instant;

  const interval = stepInterval(query.step);
  if (interval !== null) {
    const call = reach(
      first,
      {
        from: Instant.toISO(first),
        to: Instant.toISO(query.bounds.to),
        step: interval,
        filters: { ...filters.plan },
        scope,
      },
      now,
    );
    if (!call.ok) return call;
    return { ok: true, plan: { step: query.step, starts, calls: [call.plan] } };
  }

  // Month. litics' steps are fixed intervals and a month is not one, so a
  // monthly series is never a single monthly read — it is assembled from a
  // finer one.
  if (options.additive) {
    const call = reach(
      first,
      {
        from: Instant.toISO(first),
        to: Instant.toISO(query.bounds.to),
        step: "1 day",
        filters: { ...filters.plan },
        scope,
      },
      now,
    );
    if (!call.ok) return call;
    return { ok: true, plan: { step: "month", starts, calls: [call.plan] } };
  }

  const calls: RangeCall[] = [];
  for (const span of monthSpans(query.bounds.from, query.bounds.to)) {
    // A stride of the month's own length puts the whole month in one bin.
    const call = reach(
      span.start,
      {
        from: Instant.toISO(span.start),
        to: Instant.toISO(span.to),
        step: `${span.days} days`,
        filters: { ...filters.plan },
        scope,
      },
      now,
    );
    if (!call.ok) return call;
    calls.push(call.plan);
  }
  return { ok: true, plan: { step: "month", starts, calls } };
};

/** Keep grouping and whole-period distinct counts on the same validated read path. */
export const planSeries = (
  query: SeriesQuery,
  now: Instant,
  options: { readonly additive: boolean; readonly measure?: string },
): Planned<SeriesPlan> => {
  const base = planSeriesBase(query, now, options);
  if (!base.ok) return base;
  if (query.by !== undefined) {
    const problem = groupable(query.by);
    if (problem !== null) return refuse(problem);
  }
  let plan = base.plan;
  if (query.wholeWindow) {
    const stride = wholeWindowStride(
      query.bounds.from,
      query.bounds.to,
      query.step,
    );
    if (!stride) return refuse("the window ends at or before it starts");
    const filters = planFilters(query.event, query.filters);
    if (!filters.ok) return filters;
    const call = reach(
      stride.origin,
      {
        from: Instant.toISO(stride.origin),
        to: Instant.toISO(query.bounds.to),
        step: stride.interval,
        filters: { ...filters.plan },
        scope: scopeValue(query.scope),
      },
      now,
    );
    if (!call.ok) return call;
    plan = { step: query.step, starts: [stride.origin], calls: [call.plan] };
  }
  if (query.by !== undefined)
    plan = {
      ...plan,
      by: query.by,
      calls: plan.calls.map((call) => ({
        query: { ...call.query, groupBy: [query.by!] },
      })),
    };
  return { ok: true, plan };
};

export const planSums = (query: SumsQuery, now: Instant): Planned<SeriesPlan> =>
  planSeries(query, now, { additive: true, measure: query.measure });

/**
 * How a breakdown is assembled: one read, and how to rank what comes back.
 */
export type BreakdownPlan = {
  /** The dimension the rows are keyed by — also the column they arrive in. */
  readonly by: readonly string[];
  readonly order: SortDirection;
  readonly limit: number;
  readonly call: RangeCall;
};

/**
 * Plan a breakdown — one read, grouped over a declared dimension.
 *
 * The refusals are the same three a series gets (a filter no column serves, a
 * window past retention, a measure this deployment does not declare) plus one
 * of its own: a dimension that cannot be grouped on. That last one is
 * classified by the domain rather than left to litics, so a planned dimension
 * comes back as "not collected yet" and a customer property as "not a
 * declared dimension" — the same sentences a filter on either would produce,
 * because they are the same fact about the data.
 *
 * The window becomes a single bin. See `wholeWindowStride`: a breakdown is one
 * number per value over the whole window, and for uniques that is the
 * difference between one merged actor set and a wrong sum.
 */
export const planBreakdown = (
  query: BreakdownQuery,
  now: Instant,
  options: { readonly measure?: string } = {},
): Planned<BreakdownPlan> => {
  const problem = boundsProblem(query.bounds);
  if (problem !== null) return refuse(problem);

  const measureProblem = undeclaredMeasure(options.measure);
  if (measureProblem !== null) return refuse(measureProblem);

  if (!Number.isInteger(query.limit) || query.limit < 1) {
    return refuse(
      `a breakdown needs a whole-number limit of at least 1, not ${query.limit}`,
    );
  }

  const by = typeof query.by === "string" ? [query.by] : [...query.by];
  if (by.length < 1 || by.length > 3 || new Set(by).size !== by.length)
    return refuse("a breakdown needs one to three distinct properties");
  for (const field of by) {
    const grouped = groupable(field);
    if (grouped !== null) return refuse(grouped);
  }

  const filters = planFilters(query.event, query.filters);
  if (!filters.ok) return filters;

  const stride = wholeWindowStride(
    query.bounds.from,
    query.bounds.to,
    query.step,
  );
  if (stride === null) return refuse("the window ends at or before it starts");

  const call = reach(
    stride.origin,
    {
      from: Instant.toISO(stride.origin),
      to: Instant.toISO(query.bounds.to),
      step: stride.interval,
      filters: { ...filters.plan },
      groupBy: by,
      scope: scopeValue(query.scope),
    },
    now,
  );
  if (!call.ok) return call;

  return {
    ok: true,
    plan: { by, order: query.order, limit: query.limit, call: call.plan },
  };
};

/**
 * Whether a dimension can be split on at all, in the domain's own words.
 *
 * A dimension with no column of its own was never separated from the others
 * when the summary rows were written, and `props` is not consulted by a
 * grouped read. There is nothing to split, which is why this is a refusal and
 * not a slower query.
 */
const groupable = (by: string): string | null => {
  const status = DimensionCatalog.status(catalog, by);
  if (status === "planned") {
    return Answerability.describe({
      kind: "unanswerable",
      reasons: [{ kind: "DimensionNotCollected", key: by }],
    });
  }
  if (status === "unknown") {
    return Answerability.describe({
      kind: "scan",
      reasons: [{ kind: "UndeclaredDimension", key: by }],
    });
  }
  return null;
};

export type FunnelPlan = {
  readonly query: LiticsFunnelQuery;
  readonly steps: [string, string, string];
};

/**
 * Plan a funnel.
 *
 * Note what a funnel means here, because the config decides it and nothing in
 * the port says it: litics follows `actor_id`, and this deployment's actor is
 * the **visit**. So a funnel counts visits that completed all three steps, and
 * a `within` longer than a visit's idle timeout does not stretch it across
 * visits — there is no person-keyed stream for it to follow. Stated in
 * `config.ts`, repeated here because this is where someone reads it.
 */
export const planFunnel = (
  query: FunnelQuery,
  now: Instant,
): Planned<FunnelPlan> => {
  const problem = boundsProblem(query.bounds);
  if (problem !== null) return refuse(problem);

  const named = query.steps.filter((s) => s.trim().length > 0);
  if (named.length !== 3) {
    return refuse(
      "a funnel needs three named event types; one of them was blank",
    );
  }

  const earliest = Instant.minus(now, Duration.days(SEGMENT_RETENTION_DAYS));
  if (Instant.isBefore(query.bounds.from, earliest)) {
    return refuse(
      `events are kept ${SEGMENT_RETENTION_DAYS} days and the funnel window starts before that`,
    );
  }
  const span = Instant.between(query.bounds.from, query.bounds.to);
  if (Duration.compare(span, Duration.days(FUNNEL_MAX_DAYS)) > 0) {
    return refuse(
      `a funnel decodes every event in its window; windows are capped at ${FUNNEL_MAX_DAYS} days, ` +
        `and this one is longer`,
    );
  }

  const within = query.within;
  return {
    ok: true,
    plan: {
      steps: [query.steps[0], query.steps[1], query.steps[2]],
      query: {
        from: Instant.toISO(query.bounds.from),
        to: Instant.toISO(query.bounds.to),
        ...(within === undefined
          ? {}
          : {
              within: `${Math.max(1, Math.round(Duration.toSeconds(within)))} seconds`,
            }),
        scope: scopeValue(query.scope),
      },
    },
  };
};
