/**
 * Turning what the engine returned into what a tile draws.
 *
 * The two vocabularies are deliberately different. `@counted/analytics-ports`
 * speaks `Series`, `FunnelCounts` and `EngineFailure` — what an engine can
 * answer and how it can fail. `Readout` speaks scalar, series, breakdown,
 * funnel, and a failure a person can act on. This module is the only place they
 * meet, which is what keeps litics' query vocabulary from becoming the
 * console's.
 *
 * The thing this must never do is invent an empty answer. v1's dashboard loader
 * wrapped every query in `Promise.allSettled` and turned any rejection into
 * `emptyData()`, so a broken query and a genuinely empty project rendered
 * identically — a customer could not tell "you have no traffic" from "we could
 * not ask". Every failure below arrives as a stated failure with a reason.
 */

import { assertNever, Duration } from "@counted/kernel";
import type { Instant } from "@counted/kernel";
import { Readout, ReadoutId } from "@counted/dashboarding-domain";
import type { ReadoutFailure, Tile } from "@counted/dashboarding-domain";
import type { EngineFailure, EngineOutcome, FunnelCounts, Series } from "@counted/analytics-ports";

/**
 * `retriable` is the field the console acts on: a timeout gets a retry button,
 * an unsupported analysis does not. Getting this wrong in either direction is a
 * support ticket — a retry loop against a query that will never work, or a
 * customer told to give up on a blip.
 */
export const toReadoutFailure = (failure: EngineFailure): ReadoutFailure => {
  switch (failure.kind) {
    case "Timeout":
      return {
        code: "timeout",
        detail: `the engine did not answer within ${Duration.toMillis(failure.budget)}ms`,
        retriable: true,
      };
    case "Unavailable":
      return { code: "engine_unavailable", detail: failure.detail, retriable: true };
    case "InvalidQuery":
      return { code: "invalid_request", detail: failure.detail, retriable: false };
    case "NotImplemented":
      // Not an error the customer caused, and not one a retry fixes. The console
      // says "not available yet" rather than drawing an empty grid nobody can
      // tell apart from "no data".
      return {
        code: "unsupported",
        detail: `${failure.feature} is not implemented by the analytics engine`,
        retriable: false,
      };
    default:
      return assertNever(failure);
  }
};

const total = (series: Series): number => series.buckets.reduce((sum, b) => sum + b.value, 0);

/** A time series, drawn as a line or bars. Buckets are dense — zeros included. */
export const seriesReadout = (id: ReadoutId, outcome: EngineOutcome<Series>): Readout =>
  outcome.ok
    ? Readout.answered(
        id,
        {
          shape: "series",
          points: outcome.value.buckets.map((b) => ({ bucketStart: b.start, value: b.value })),
        },
        outcome.computedAt,
      )
    : Readout.failed(id, toReadoutFailure(outcome.error));

/**
 * One number, drawn as a headline.
 *
 * The series is summed, not sampled. "Visitors this week" is the week's total;
 * a card that quietly showed only the most recent bucket while its label said
 * "this week" is the v1 metric-card bug, and it is invisible because the number
 * it draws is always plausible.
 */
export const scalarReadout = (id: ReadoutId, outcome: EngineOutcome<Series>): Readout =>
  outcome.ok
    ? Readout.answered(id, { shape: "scalar", value: total(outcome.value) }, outcome.computedAt)
    : Readout.failed(id, toReadoutFailure(outcome.error));

export const funnelReadout = (id: ReadoutId, outcome: EngineOutcome<FunnelCounts>): Readout =>
  outcome.ok
    ? Readout.answered(id, { shape: "funnel", counts: [...outcome.value.counts] }, outcome.computedAt)
    : Readout.failed(id, toReadoutFailure(outcome.error));

export type BreakdownPart = {
  readonly label: string;
  readonly outcome: EngineOutcome<Series>;
};

/**
 * Assemble a breakdown from one series per dimension value.
 *
 * **Nothing calls this today.** It was how a breakdown was built when the
 * engine had no group-by: one query per value, folded together here. The API
 * now asks `AnalyticsEngine.countsBy` and gets the rows in one read, so this is
 * the fan-out assembler with no fan-out left to assemble. Kept because the next
 * question that genuinely needs one — a comparison against a prior period, a
 * dimension whose values come from somewhere other than the cube — will want
 * exactly this shape, and its rule below is the one worth keeping.
 *
 * If any part failed, the whole readout fails. Dropping the failed rows and
 * drawing the rest would silently re-rank the chart: the bar that is missing is
 * exactly the one a reader would have wanted to see, and nothing on the page
 * would say a row was omitted.
 *
 * `computedAt` is when the set was assembled, not when any one part answered.
 * The parts were run over some interval and reporting the first one's timestamp
 * as the readout's would claim more precision than there is.
 */
export const breakdownReadout = (
  id: ReadoutId,
  parts: readonly BreakdownPart[],
  computedAt: Instant,
): Readout => {
  const rows: { label: string; value: number }[] = [];

  for (const part of parts) {
    if (!part.outcome.ok) return Readout.failed(id, toReadoutFailure(part.outcome.error));
    rows.push({ label: part.label, value: total(part.outcome.value) });
  }

  // No parts is a real answer — a breakdown over a dimension with no values —
  // and not a failure. It is also the case v1 could not distinguish.
  return Readout.answered(id, { shape: "breakdown", rows }, computedAt);
};

/**
 * A tile's readout is correlated by the tile's id. A monitor asks its question
 * through the same path and its answer is not a tile's, which is why `ReadoutId`
 * is an opaque correlation id rather than a `TileId`.
 */
export const readoutIdFor = <A>(tile: Tile<A>): ReadoutId => ReadoutId(tile.id);
