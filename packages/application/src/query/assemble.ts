/**
 * Turning what the store returned into what the client reads.
 *
 * The store returns raw counts. Every rate, every calendar decision, every
 * "this period has not begun yet" lives in the domain and is applied here, so
 * the arithmetic is testable without a database and SQL has no opinion about
 * percentages.
 *
 * The shape is always tagged. v1's `/query` multiplexed three shapes onto one
 * response with no discriminator, so the client reconstructed the branch
 * condition itself — and got it wrong, because `meta.totalEvents` meant three
 * different things depending which branch had fired.
 */

import {
  Funnel,
  Retention,
  TimeAxis,
  err,
  ok,
  type Instant,
  type ReadoutFailure,
  type ReadoutValue,
  type Result,
} from "@counted/domain";
import type { StoreError, StoreResult } from "@counted/ports";
import type { Plan } from "./plan";

export type AssembleError = {
  readonly code: "unsupported" | "invalid_request";
  readonly detail: string;
};

/**
 * A result of the wrong kind for the request that asked for it.
 *
 * Cannot happen through a correct adapter, and is reported rather than
 * coerced: silently reading a `scalar` as a `series` would render a chart with
 * one point and no indication anything was wrong.
 */
const mismatch = (expected: string, got: string): AssembleError => ({
  code: "invalid_request",
  detail: `The store answered with a ${got} where a ${expected} was requested.`,
});

export const assemble = (plan: Plan, result: StoreResult): Result<ReadoutValue, AssembleError> => {
  const { request, question } = plan;

  switch (request.kind) {
    case "scalar":
      if (result.kind !== "scalar") return err(mismatch("scalar", result.kind));
      return ok({ shape: "scalar", value: result.value });

    case "series": {
      if (result.kind !== "series") return err(mismatch("series", result.kind));
      const buckets = TimeAxis.bucketCount(request.axis);
      if (result.values.length !== buckets) {
        // A dense series is the contract. A short one would silently shift
        // every point after the gap onto the wrong date.
        return err({
          code: "invalid_request",
          detail: `The store returned ${result.values.length} buckets for an axis of ${buckets}.`,
        });
      }
      // The bucket's start, from the same edges the store was handed. There is
      // no second calendar here to disagree with the first.
      const points = result.values.map((value, i) => ({
        bucketStart: request.axis.edges[i] as Instant,
        value,
      }));
      return ok({ shape: "series", points });
    }

    case "breakdown":
      if (result.kind !== "breakdown") return err(mismatch("breakdown", result.kind));
      return ok({ shape: "breakdown", rows: result.rows.map((r) => ({ label: r.label, value: r.value })) });

    case "sequence": {
      if (result.kind !== "sequence") return err(mismatch("sequence", result.kind));
      if (question.kind !== "funnel") return err(mismatch("funnel question", question.kind));
      // Rates, drop-off and the monotonicity check all live in the domain.
      // v1 divided without guarding, so an empty first step rendered "NaN%".
      const summarized = Funnel.summarize(question.funnel, result.counts);
      if (!summarized.ok) {
        return err({
          code: "invalid_request",
          detail: `The funnel counts are not usable: ${summarized.error.detail}.`,
        });
      }
      return ok({ shape: "funnel", result: summarized.value });
    }

    case "cohorts": {
      if (result.kind !== "cohorts") return err(mismatch("cohorts", result.kind));
      if (question.kind !== "retention") return err(mismatch("retention question", question.kind));
      // `now` comes from the bounds the planner already resolved, so the grid's
      // notion of "this period has not begun" matches the window it was asked
      // about rather than the instant this line runs.
      const grid = Retention.buildGrid(
        question.retention,
        result.sizes,
        result.observations,
        request.bounds.to,
      );
      return ok({ shape: "retention", grid });
    }
  }
};

/** A store failure, in the vocabulary a readout speaks. */
export const failureFrom = (error: StoreError): ReadoutFailure => ({
  code: error.code,
  detail:
    error.code === "timeout"
      ? `The query did not finish inside its ${error.budgetMs}ms budget. A narrower window usually will.`
      : error.detail,
  retriable: error.retriable,
});

export const failureFromAssemble = (error: AssembleError): ReadoutFailure => ({
  code: error.code,
  detail: error.detail,
  retriable: false,
});
