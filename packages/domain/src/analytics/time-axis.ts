/**
 * TimeAxis — the bucket boundaries an analysis is sliced into.
 *
 * This module exists so there is exactly **one** implementation of bucketing.
 *
 * v1 had three. `query.timeBucket` compiled to Timescale's
 * `time_bucket('1 day', ts)`; `groupBy: {type:"time"}` compiled to
 * `date_trunc('day', ts)` in the same file; and the zero-fill axis was
 * computed again in JavaScript, hand-aligned to Monday with `(getUTCDay()+6)%7`
 * to match `time_bucket`'s `2000-01-03` origin. Nothing enforced that the three
 * agreed — the coupling was a code comment. When they disagreed, points landed
 * in the wrong bucket and nobody found out.
 *
 * Here the domain computes the edges and the adapter is *given* them:
 *
 *     width_bucket(occurred_at, $edges::timestamptz[])
 *
 * There is no bucket expression in SQL to get wrong, `time_bucket` disappears
 * entirely, and calendar months stop being 30 days.
 *
 * Everything is UTC. Per-workspace time zones are a real feature and a
 * deliberate follow-up: the seam is `truncTo`/`step`, which are the only two
 * functions that would need a zone argument.
 */

import { assertNever } from "../shared/brand";
import { Duration } from "../shared/duration";
import { Instant } from "../shared/instant";
import type { Grain, Window } from "./window";

/** 0 = Sunday, matching `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** ISO-8601 says weeks start on Monday, and so do we unless told otherwise. */
export const DEFAULT_WEEK_START: Weekday = 1;

/** A hard ceiling so a pathological window cannot allocate forever. */
export const MAX_BUCKETS = 10_000;

export type TimeAxis = {
  readonly grain: Grain;
  readonly weekStart: Weekday;
  /**
   * Bucket boundaries, ascending. `n` buckets have `n + 1` edges: bucket `i`
   * covers `[edges[i], edges[i+1])`, half-open so no event lands in two.
   */
  readonly edges: readonly Instant[];
};

/**
 * Truncate down to the start of the bucket containing this instant.
 *
 * Idempotent, and never moves forwards.
 */
export const truncTo = (
  grain: Grain,
  at: Instant,
  weekStart: Weekday = DEFAULT_WEEK_START,
): Instant => {
  const d = new Date(Instant.toEpochMillis(at));
  switch (grain) {
    case "hour":
      d.setUTCMinutes(0, 0, 0);
      return Instant.fromEpochMillis(d.getTime());
    case "day":
      d.setUTCHours(0, 0, 0, 0);
      return Instant.fromEpochMillis(d.getTime());
    case "week": {
      d.setUTCHours(0, 0, 0, 0);
      // Days to step back to reach weekStart. Always in [0, 6].
      const back = (d.getUTCDay() - weekStart + 7) % 7;
      d.setUTCDate(d.getUTCDate() - back);
      return Instant.fromEpochMillis(d.getTime());
    }
    case "month":
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      return Instant.fromEpochMillis(d.getTime());
    default:
      return assertNever(grain);
  }
};

/**
 * Advance one whole bucket. Months walk the calendar rather than adding a
 * fixed span — that is the whole reason this is not `Instant.plus(d, ...)`.
 */
export const step = (grain: Grain, from: Instant): Instant => {
  switch (grain) {
    case "hour":
      return Instant.plus(from, Duration.hours(1));
    case "day":
      return Instant.plus(from, Duration.days(1));
    case "week":
      return Instant.plus(from, Duration.days(7));
    case "month": {
      const d = new Date(Instant.toEpochMillis(from));
      // Safe because month edges are always the 1st at 00:00 UTC, so there is
      // no end-of-month clamping to worry about.
      d.setUTCMonth(d.getUTCMonth() + 1);
      return Instant.fromEpochMillis(d.getTime());
    }
    default:
      return assertNever(grain);
  }
};

/** Days in a given UTC month. Day 0 of the next month is the last of this one. */
const daysInMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * Go back whole calendar months, clamping to the end of the target month.
 *
 * Naively calling `setUTCMonth(m - 1)` overflows: one month before 2026-03-31
 * becomes "2026-02-31", which JavaScript rolls forward to 2026-03-03 — so
 * "last 1 month" on the 31st would be a 28-day window ending three days after
 * it started. Clamping gives 2026-02-28, which is what a person means.
 */
const minusMonths = (d: Date, amount: number): void => {
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - amount);
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth())));
};

/** Resolve a window against the current instant into concrete bounds. */
export const resolveWindow = (w: Window, now: Instant): { from: Instant; to: Instant } => {
  if (w.kind === "absolute") return { from: w.from, to: w.to };

  const d = new Date(Instant.toEpochMillis(now));
  switch (w.unit) {
    case "hour":
      d.setUTCHours(d.getUTCHours() - w.amount);
      break;
    case "day":
      d.setUTCDate(d.getUTCDate() - w.amount);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() - w.amount * 7);
      break;
    case "month":
      minusMonths(d, w.amount);
      break;
    default:
      return assertNever(w.unit);
  }
  return { from: Instant.fromEpochMillis(d.getTime()), to: now };
};

export const TimeAxis = {
  /**
   * Build the axis for a window. The first edge is the bucket *containing*
   * `from`, so a partial leading bucket is included rather than silently
   * dropping the events in it. Edges continue until the bucket containing `to`
   * has been closed.
   */
  build: (
    window: Window,
    grain: Grain,
    now: Instant,
    weekStart: Weekday = DEFAULT_WEEK_START,
  ): TimeAxis => {
    const { from, to } = resolveWindow(window, now);

    const edges: Instant[] = [];
    let cursor = truncTo(grain, from, weekStart);
    edges.push(cursor);

    while (cursor <= to && edges.length <= MAX_BUCKETS) {
      cursor = step(grain, cursor);
      edges.push(cursor);
    }

    return { grain, weekStart, edges };
  },

  bucketCount: (axis: TimeAxis): number => Math.max(0, axis.edges.length - 1),

  /** Start instants of each bucket — the x-axis of a chart. */
  bucketStarts: (axis: TimeAxis): readonly Instant[] => axis.edges.slice(0, -1),

  /**
   * Which bucket an instant falls in, or `null` if it lies outside the axis.
   * Half-open on the right: an instant exactly on an edge belongs to the
   * bucket that edge *starts*.
   *
   * Binary search, so assigning a large result set stays cheap.
   */
  assign: (axis: TimeAxis, at: Instant): number | null => {
    const { edges } = axis;
    const first = edges[0];
    const last = edges[edges.length - 1];
    if (first === undefined || last === undefined) return null;
    if (at < first || at >= last) return null;

    let lo = 0;
    let hi = edges.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      const edge = edges[mid];
      if (edge === undefined) break;
      if (at < edge) hi = mid;
      else lo = mid;
    }
    return lo;
  },

  /**
   * Turn sparse (bucketIndex, value) pairs into a dense array. Zero-fill is
   * arithmetic over the axis, not a Map merge against whatever keys the
   * database happened to return.
   */
  densify: (axis: TimeAxis, points: readonly { index: number; value: number }[]): number[] => {
    const out = new Array<number>(TimeAxis.bucketCount(axis)).fill(0);
    for (const p of points) {
      if (p.index >= 0 && p.index < out.length) out[p.index] = p.value;
    }
    return out;
  },

  /** Edges as epoch millis — the form an adapter binds as a SQL array. */
  edgeMillis: (axis: TimeAxis): number[] => axis.edges.map(Instant.toEpochMillis),
} as const;
