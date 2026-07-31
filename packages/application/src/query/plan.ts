/**
 * Turning a question into a store request.
 *
 * Two things happen here and nowhere else:
 *
 *   **The window is resolved once**, against the Clock, into absolute bounds.
 *   The store is never handed a relative window, because resolving one needs a
 *   clock and an adapter with a clock is an adapter that can disagree with the
 *   domain about what "last 7 days" meant.
 *
 *   **The bucket edges are computed here**, by the domain, and handed to the
 *   store. There is no second bucketing implementation for SQL to disagree
 *   with — v1 had `time_bucket` on one path and `date_trunc` on another, and
 *   they disagreed about week alignment and about calendar months.
 *
 * Which store request a question becomes is decided by the question's own
 * shape rather than by inspecting optional fields. v1 inferred the branch from
 * whether `groupBy` happened to be set, which is how a breakdown with a time
 * dimension silently became something else.
 */

import {
  Analysis,
  Funnel,
  MAX_BUCKETS,
  Retention,
  TimeAxis,
  Window,
  err,
  ok,
  resolveWindow,
  type AnalysisError,
  type FunnelError,
  type Grain,
  type Instant,
  type ProjectId,
  type Result,
  type RetentionError,
} from "@counted/domain";
import type { RequestId, ResolvedBounds, StoreRequest } from "@counted/ports";

/**
 * A question, in the three shapes the product actually asks.
 *
 * The same union a dashboard tile holds, so a tile and an ad-hoc query take
 * exactly the same path. v1 had a separate code path for dashboards and the
 * two drifted.
 */
export type Question =
  | { readonly kind: "analysis"; readonly analysis: Analysis }
  | { readonly kind: "funnel"; readonly funnel: Funnel }
  | { readonly kind: "retention"; readonly retention: Retention };

export type PlanError =
  | { readonly kind: "InvalidAnalysis"; readonly error: AnalysisError }
  | { readonly kind: "InvalidFunnel"; readonly error: FunnelError }
  | { readonly kind: "InvalidRetention"; readonly error: RetentionError }
  | { readonly kind: "TooManyBuckets"; readonly requested: number; readonly max: number };

/** The plan for one question: what to ask the store, and how to read it back. */
export type Plan = {
  readonly request: StoreRequest;
  readonly question: Question;
};

const boundsOf = (window: Window, now: Instant): ResolvedBounds => {
  const { from, to } = resolveWindow(window, now);
  return { from, to };
};

/**
 * The time dimension of an analysis, if it has one.
 *
 * At most one is allowed — `Analysis.validate` rejects several — so finding
 * the first is finding the only.
 */
const timeGrainOf = (analysis: Analysis): Grain | null => {
  for (const dimension of analysis.groupBy ?? []) {
    if (dimension.by === "time") return dimension.grain;
  }
  return null;
};

const hasFieldDimension = (analysis: Analysis): boolean =>
  (analysis.groupBy ?? []).some((d) => d.by === "field");

export const planQuestion = (
  id: RequestId,
  project: ProjectId,
  question: Question,
  now: Instant,
): Result<Plan, PlanError> => {
  switch (question.kind) {
    case "analysis": {
      // Validated here rather than trusted. The wire schema checks shape; this
      // checks the rules only the domain knows.
      const validated = Analysis.validate(question.analysis);
      if (!validated.ok) return err({ kind: "InvalidAnalysis", error: validated.error });
      const analysis = validated.value;
      const bounds = boundsOf(analysis.window, now);

      const grain = timeGrainOf(analysis);
      if (grain !== null) {
        const axis = TimeAxis.build(analysis.window, grain, now);

        // `TimeAxis.build` stops at MAX_BUCKETS rather than overflowing, so a
        // window too long for its grain comes back *truncated* — an axis that
        // silently covers less time than was asked for. Checking the count
        // against the cap would never fire; checking whether the axis reaches
        // the end of the window is what actually detects it.
        const last = axis.edges[axis.edges.length - 1];
        if (last === undefined || last < bounds.to) {
          const buckets = TimeAxis.bucketCount(axis);
          return err({ kind: "TooManyBuckets", requested: buckets, max: MAX_BUCKETS });
        }
        return ok({
          request: { id, kind: "series", project, analysis, axis, bounds },
          question,
        });
      }

      if (hasFieldDimension(analysis)) {
        return ok({ request: { id, kind: "breakdown", project, analysis, bounds }, question });
      }

      return ok({ request: { id, kind: "scalar", project, analysis, bounds }, question });
    }

    case "funnel": {
      const validated = Funnel.validate(question.funnel);
      if (!validated.ok) return err({ kind: "InvalidFunnel", error: validated.error });
      const funnel = validated.value;
      return ok({
        request: { id, kind: "sequence", project, funnel, bounds: boundsOf(funnel.window, now) },
        question,
      });
    }

    case "retention": {
      const validated = Retention.validate(question.retention);
      if (!validated.ok) return err({ kind: "InvalidRetention", error: validated.error });
      const retention = validated.value;
      return ok({
        request: { id, kind: "cohorts", project, retention, bounds: boundsOf(retention.window, now) },
        question,
      });
    }
  }
};

/** Human-readable, for a problem detail. One sentence, no jargon. */
export const explainPlanError = (error: PlanError): string => {
  switch (error.kind) {
    case "TooManyBuckets":
      return `That window and grain would produce ${error.requested} buckets; the maximum is ${error.max}. Use a coarser grain or a shorter window.`;
    case "InvalidAnalysis":
      return explainAnalysisError(error.error);
    case "InvalidFunnel":
      return explainFunnelError(error.error);
    case "InvalidRetention":
      return explainRetentionError(error.error);
  }
};

const explainAnalysisError = (error: AnalysisError): string => {
  switch (error.kind) {
    case "EmptyEventName":
      return "An event name must not be empty.";
    case "EmptyPropertyKey":
      return "A property key must not be empty.";
    case "AggregatePropertyRequired":
      return "sum, avg, min and max each need a property to aggregate.";
    case "MultipleTimeDimensions":
      return `An analysis may group by time once; this one does it ${error.count} times.`;
    case "EmptyPredicateGroup":
      return `An empty ${error.op} group matches nothing and is almost certainly a mistake.`;
    case "EmptyValueList":
      return `${error.op} needs at least one value.`;
    case "LimitOutOfRange":
      return `A limit of ${error.limit} is outside the permitted range.`;
    case "NonPositiveWindow":
      return `A window of ${error.amount} is not a span of time.`;
    case "InvertedWindow":
      return "The window ends before it starts.";
  }
};

const explainFunnelError = (error: FunnelError): string => {
  switch (error.kind) {
    case "StepWithoutEvents":
      return "Every funnel step must name at least one event.";
    case "TooFewSteps":
      return "A funnel needs at least two steps; one step is just a count.";
    case "TooManySteps":
      return `A funnel may have at most ${error.max} steps.`;
    case "EmptyEventName":
      return "Every funnel step must name at least one event.";
    case "NonPositiveConversionWindow":
      return "The conversion window must be a positive span of time.";
  }
};

const explainRetentionError = (error: RetentionError): string => {
  switch (error.kind) {
    case "NonPositivePeriods":
      return "Retention needs at least one follow-up period.";
    case "TooManyPeriods":
      return `Retention may report at most ${error.max} periods.`;
    case "EmptyEventName":
      return "An event name must not be empty.";
  }
};
