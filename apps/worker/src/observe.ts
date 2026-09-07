/**
 * Turning a monitor's Analysis into the one number a threshold compares
 * against.
 *
 * **The most important thing in this file is what it refuses to return.** A
 * monitor evaluation that cannot get an answer must not produce a number, and
 * the number it must especially not produce is zero. `Threshold.below(100)` is
 * breached by zero, so an engine timeout read as "0 events" fires a page at
 * three in the morning claiming traffic collapsed. v1's dashboard did exactly
 * this substitution — `Promise.allSettled` plus an `emptyData()` fallback — and
 * the monitor path inherits the same temptation because it *needs* a number.
 * So `Observation` has three cases and only one of them carries a value.
 *
 * `no-data` is separate from `unobservable` for the same reason
 * `SummaryStat.apply` returns `null` on an empty series: the peak of nothing is
 * not zero, and neither is the latest value of nothing. Note the boundary
 * carefully — the engine returns a *dense* series, so a quiet project comes
 * back as buckets of zero, and those are real observations a threshold may
 * legitimately fire on. `no-data` means there were no buckets at all, which is
 * a window with no grid rather than a project with no traffic.
 *
 * **This is the temporary home of the Analysis-to-engine translation.** It
 * belongs in `@counted/analytics-app`, which is empty at the time of writing;
 * the seam is `ScalarObserver`, so replacing this with that package's version
 * is one line in `main.ts` and a deletion here. Only the scalar shape is
 * handled, which is all a monitor may hold.
 */

import {
  Analysis,
  Answerability,
  classifyPredicate,
  DimensionCatalog,
  resolveWindow,
  SummaryStat,
  Window,
  type CountingBasis,
} from "@counted/analytics-domain";
import type {
  AnalyticsEngine,
  EngineFailure,
  EngineOutcome,
  Filters,
  Series,
  SeriesQuery,
  Step,
} from "@counted/analytics-ports";
import type { Monitor } from "@counted/dashboarding-domain";
import { Duration, unbrand, type Instant, type ProjectId } from "@counted/kernel";
import type { IdGenerator } from "@counted/kernel/ports";

/**
 * What one evaluation tick learned. Exactly one case carries a number.
 *
 * `retriable` mirrors `ReadoutFailure.retriable` in `@counted/dashboarding-app`
 * and means the same thing: a timeout is worth trying again in five minutes, an
 * analysis the engine cannot express is not. It is the difference between a
 * monitor that recovers on its own and one that needs somebody to edit it.
 */
export type Observation =
  | { readonly kind: "observed"; readonly value: number; readonly computedAt: Instant }
  | { readonly kind: "no-data" }
  | { readonly kind: "unobservable"; readonly detail: string; readonly retriable: boolean };

export type ScalarObserver<A> = (monitor: Monitor<A>, now: Instant) => Promise<Observation>;

export type EngineObserverDeps = {
  readonly engine: AnalyticsEngine;
  /** How long one monitor's query may take before it is abandoned. */
  readonly deadline: Duration;
  /**
   * Which dimensions a filter may name. Supplied rather than assumed so this
   * file has no opinion about which engine is behind the port —
   * `@counted/analytics-adapter-litics` exports the catalog it actually built.
   */
  readonly catalog: DimensionCatalog;
  readonly ids: IdGenerator;
};

const unobservable = (detail: string, retriable: boolean): Observation => ({
  kind: "unobservable",
  detail,
  retriable,
});

/**
 * An engine failure, as an observation.
 *
 * The mapping is the same judgement `toReadoutFailure` makes for a tile, and it
 * has to agree with it: a customer who sees "temporarily unavailable, retrying"
 * on the dashboard and gets a monitor that gave up permanently on the same
 * query has been told two different things about one fact.
 */
export const fromEngineFailure = (failure: EngineFailure): Observation => {
  switch (failure.kind) {
    case "Timeout":
      return unobservable(
        `the engine did not answer within ${Duration.toMillis(failure.budget)}ms`,
        true,
      );
    case "Unavailable":
      return unobservable(failure.detail, true);
    case "InvalidQuery":
      return unobservable(failure.detail, false);
    case "NotImplemented":
      return unobservable(`the engine does not implement ${failure.feature}`, false);
    default: {
      // Not `assertNever`: this value came off a port implemented elsewhere, and
      // a background loop should report an unfamiliar failure rather than throw
      // inside a sweep that still has two hundred monitors to run.
      const unexpected: { kind: string } = failure;
      return unobservable(`the engine failed with an unrecognised kind: ${unexpected.kind}`, false);
    }
  }
};

/**
 * The step a scalar question is measured at.
 *
 * A scalar has no grain of its own — it is a single number — but the engine
 * only answers in buckets, so one has to be chosen and then summarised away.
 * `Window.defaultGrain` is the same choice a series tile would make over the
 * same window, which matters for two reasons: the query reads the same store
 * (so a monitor cannot silently reach past retention where the chart
 * beside it does not), and `average` means "per day" in both places.
 */
export const stepFor = (window: Window): Step => Window.defaultGrain(window);

const scalarQuery = (
  analysis: Extract<Analysis, { shape: "scalar" }>,
  project: ProjectId,
  now: Instant,
  catalog: DimensionCatalog,
): { readonly query: SeriesQuery } | { readonly refusal: string } => {
  const answerability = classifyPredicate(analysis.where, catalog);
  if (answerability.kind !== "indexed" && answerability.kind !== "scan") return { refusal: Answerability.describe(answerability) };

  const bounds = resolveWindow(analysis.window, now);
  const filters: Filters = answerability.kind === "indexed" ? answerability.plan.filters : {};
  const event = answerability.kind === "indexed" ? answerability.plan.event : undefined;

  return {
    query: {
      scope: { level: "project", project },
      bounds,
      step: stepFor(analysis.window),
      ...(analysis.measure.kind === "unique" && analysis.summary === "total" ? { wholeWindow: true } : {}),
      ...(answerability.kind === "scan" && analysis.where ? { predicate: analysis.where } : {}),
      ...(event === undefined ? {} : { event }),
      ...(Object.keys(filters).length === 0 ? {} : { filters }),
    },
  };
};

/**
 * `uniques` counts what the deployment's actor is, and that is the visit.
 *
 * litics follows one actor column; `@counted/analytics-adapter-litics`'s config
 * sets it to the visit id. So "unique people" has no answer here — not a slow
 * one, none — and a monitor asking for it must say so rather than quietly
 * reporting unique visits, which is a larger number and would keep an
 * `above` threshold permanently breached.
 */
const basisRefusal = (basis: CountingBasis): string | null =>
  basis === "person"
    ? "this deployment counts unique visits, not unique people; a monitor cannot be based on people yet"
    : null;

export const engineObserver = (deps: EngineObserverDeps): ScalarObserver<Analysis> => {
  return async (monitor, now) => {
    const analysis = monitor.analysis;

    const valid = Analysis.validate(analysis);
    if (!valid.ok) {
      return unobservable(
        valid.error.kind === "InvalidAnalysis"
          ? valid.error.detail
          : `${valid.error.kind}: the stored analysis cannot be run`,
        false,
      );
    }

    if (analysis.shape !== "scalar") {
      // `AnalysisCheck` refuses this at create and update time. Reaching it here
      // means a row predates the check or was written around it, and running a
      // funnel or a breakdown would produce several numbers with no rule for
      // picking one.
      return unobservable(
        `a monitor's analysis must produce one number; this one is a ${analysis.shape}`,
        false,
      );
    }

    if (analysis.measure.kind === "unique") {
      const refusal = basisRefusal(analysis.measure.basis);
      if (refusal !== null) return unobservable(refusal, false);
    }

    const planned = scalarQuery(analysis, monitor.project, now, deps.catalog);
    if ("refusal" in planned) return unobservable(planned.refusal, false);

    const options = {
      deadline: deps.deadline,
      traceId: `monitor:${unbrand(monitor.id)}:${deps.ids.next()}`,
    };

    let outcome: EngineOutcome<Series>;
    switch (analysis.measure.kind) {
      case "count":
        outcome = await deps.engine.counts(planned.query, options);
        break;
      case "unique":
        outcome = await deps.engine.uniques(planned.query, options);
        break;
      case "sum":
        outcome = await deps.engine.sums(
          { ...planned.query, measure: analysis.measure.name },
          options,
        );
        break;
      default: {
        const unexpected: { kind: string } = analysis.measure;
        return unobservable(`unrecognised measure: ${unexpected.kind}`, false);
      }
    }

    if (!outcome.ok) return fromEngineFailure(outcome.error);

    const collapsed = SummaryStat.apply(
      analysis.summary,
      outcome.value.buckets.map((bucket) => bucket.value),
    );
    if (collapsed === null) return { kind: "no-data" };

    return { kind: "observed", value: collapsed, computedAt: outcome.computedAt };
  };
};
