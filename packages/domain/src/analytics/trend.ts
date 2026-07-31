/**
 * Trends and summary statistics.
 *
 * Two v1 defects are designed out here.
 *
 * **Months were 30 days.** `computePreviousTimeRange` derived the prior period
 * by subtracting a millisecond span from `unitToMs`, where a month was a flat
 * 30 days. Every month-over-month comparison was therefore off by up to 3.3%,
 * silently, forever. Here the previous window is derived by applying the same
 * *calendar* shift again, so "the month before last month" is a real month.
 *
 * **Numbers were strings.** `MetricData.value` was produced with
 * `toLocaleString()` inside the query layer, and the trend calculation then
 * did `parseFloat(data.value.replace(/,/g, ""))` to get a number back out.
 * Presentation had leaked into the domain payload and was being un-leaked by
 * regex. Everything in this module is a number; formatting belongs to whatever
 * renders it.
 */

import { assertNever } from "../shared/brand";
import { Instant } from "../shared/instant";
import { resolveWindow } from "./time-axis";
import { Window } from "./window";

/**
 * The window immediately before this one, of comparable length.
 *
 * For a relative window the same calendar shift is applied again, so a month
 * step lands on a real month boundary rather than 30 days earlier. For an
 * absolute window the span is mirrored backwards from its start.
 *
 * The returned window is always absolute: a "previous period" is a fixed
 * stretch of history, not something that should drift as the clock moves.
 */
export const previousWindow = (w: Window, now: Instant): Window => {
  const { from, to } = resolveWindow(w, now);

  if (w.kind === "absolute") {
    const span = Instant.toEpochMillis(to) - Instant.toEpochMillis(from);
    return Window.between(Instant.fromEpochMillis(Instant.toEpochMillis(from) - span), from);
  }

  // Re-resolving the same relative window against `from` walks the calendar a
  // second time, which is what keeps months honest.
  const previousFrom = resolveWindow(w, from).from;
  return Window.between(previousFrom, from);
};

export type TrendDirection = "up" | "down" | "flat";

export type Trend = {
  readonly current: number;
  readonly previous: number;
  /** current - previous. Always defined. */
  readonly absoluteChange: number;
  /**
   * Percentage change, or `null` when there is no baseline to compare to.
   *
   * Going from 0 to 100 is not "a 0% increase", and it is not infinite growth
   * either — it is a change with no meaningful denominator. v1 returned 0 and
   * rendered "+0%" next to a number that had gone from nothing to something.
   */
  readonly percentChange: number | null;
  readonly direction: TrendDirection;
};

export const Trend = {
  between: (current: number, previous: number): Trend => {
    const absoluteChange = current - previous;
    return {
      current,
      previous,
      absoluteChange,
      percentChange: previous === 0 ? null : (absoluteChange / previous) * 100,
      direction: absoluteChange > 0 ? "up" : absoluteChange < 0 ? "down" : "flat",
    };
  },

  /** True when there was a baseline and the number moved. */
  isComparable: (t: Trend): boolean => t.percentChange !== null,

  /**
   * Whether this movement is worth drawing attention to. Some metrics are
   * better when they fall — page load time, error count — so the caller says
   * which direction is good rather than the domain assuming more is better.
   */
  isFavourable: (t: Trend, higherIsBetter: boolean): boolean => {
    if (t.direction === "flat") return false;
    return higherIsBetter ? t.direction === "up" : t.direction === "down";
  },
} as const;

/** How a series collapses to one headline number. */
export type SummaryStat = "total" | "average" | "peak" | "low" | "latest";

export const SUMMARY_STATS: readonly SummaryStat[] = [
  "total",
  "average",
  "peak",
  "low",
  "latest",
];

export const SummaryStat = {
  /**
   * Collapse a series. An empty series is 0 for every statistic — there is
   * nothing to report, and 0 is the honest answer for a count.
   */
  apply: (stat: SummaryStat, series: readonly number[]): number => {
    if (series.length === 0) return 0;
    switch (stat) {
      case "total":
        return series.reduce((a, b) => a + b, 0);
      case "average":
        return series.reduce((a, b) => a + b, 0) / series.length;
      case "peak":
        return series.reduce((a, b) => (b > a ? b : a), series[0]!);
      case "low":
        return series.reduce((a, b) => (b < a ? b : a), series[0]!);
      case "latest":
        return series[series.length - 1]!;
      default:
        return assertNever(stat);
    }
  },

  label: (stat: SummaryStat): string => {
    switch (stat) {
      case "total":
        return "Total";
      case "average":
        return "Average";
      case "peak":
        return "Peak";
      case "low":
        return "Low";
      case "latest":
        return "Latest";
      default:
        return assertNever(stat);
    }
  },

  /**
   * Whether the statistic is meaningful per bucket. "Average" needs a unit to
   * read sensibly — average per day, per hour — whereas a total does not.
   */
  isPerBucket: (stat: SummaryStat): boolean => stat === "average",
} as const;
