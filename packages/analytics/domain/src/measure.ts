/**
 * Measures — the number an analysis produces — and the basis it is counted on.
 *
 * `unique` names its basis. v1 accepted `unique_users` as a public API measure
 * and compiled it to `COUNT(DISTINCT session_id)` with a comment admitting it
 * was an alias, so the API answered a question about people with a number about
 * visits. Here `unique(person)` and `unique(visit)` are different measures, and
 * the person one only produces sensible numbers on identified events — which
 * both validation and the planner know.
 *
 * The set is narrow on purpose. v2 carried `avg`, `min` and `max` alongside
 * `sum`; the engine has counts, uniques and sums and nothing else, so those
 * three were three promises with no implementation behind them. They are not
 * modelled here rather than modelled and refused, because an IR that can
 * express a question nobody can answer is how v1 ended up with a free-text
 * metric column and its own second compiler.
 */

import { assertNever } from "@counted/kernel";

/**
 * Whether a question counts visits or people.
 *
 * This is the query-side half of the person/visit separation that ingestion
 * owns. It lives here, not imported, because a domain may not reach into
 * another context's domain — and because the counting rule is genuinely an
 * analytics concern: the ingestion side records both, and only the question
 * decides which one is the honest denominator.
 */
export type CountingBasis = "visit" | "person";

export const COUNTING_BASES: readonly CountingBasis[] = ["visit", "person"];

export const CountingBasis = {
  label: (b: CountingBasis): string => {
    switch (b) {
      case "visit":
        return "visits";
      case "person":
        return "people";
      default:
        return assertNever(b);
    }
  },

  /**
   * Whether a basis can answer questions that span visits. A visit ends after
   * 30 minutes idle, so anything asking "did they come back" needs `person`.
   */
  spansVisits: (b: CountingBasis): boolean => b === "person",
} as const;

export type Measure =
  | { readonly kind: "count" }
  | { readonly kind: "unique"; readonly basis: CountingBasis }
  /** Sum of a declared numeric measure. `name` is a measure, not a property. */
  | { readonly kind: "sum"; readonly name: string };

export const Measure = {
  count: (): Measure => ({ kind: "count" }),
  uniqueVisits: (): Measure => ({ kind: "unique", basis: "visit" }),
  uniquePeople: (): Measure => ({ kind: "unique", basis: "person" }),
  sum: (name: string): Measure => ({ kind: "sum", name }),

  label: (m: Measure): string => {
    switch (m.kind) {
      case "count":
        return "Events";
      case "unique":
        return m.basis === "person" ? "People" : "Visits";
      case "sum":
        return `Total ${m.name}`;
      default:
        return assertNever(m);
    }
  },

  /**
   * Whether the number is approximate.
   *
   * Uniques come from HLL sketches — roughly 1–2% error. Saying so is not
   * pedantry: a caller that renders an estimate as an exact figure is making a
   * claim the data does not support, and this is the only place that fact is
   * recorded.
   */
  isApproximate: (m: Measure): boolean => m.kind === "unique",

  /** True when the measure can only be answered on identified events. */
  requiresPerson: (m: Measure): boolean => m.kind === "unique" && m.basis === "person",

  /** The declared measure this reads, if any. Validation checks it exists. */
  readsMeasure: (m: Measure): string | null => (m.kind === "sum" ? m.name : null),

  toKey: (m: Measure): string => {
    switch (m.kind) {
      case "count":
        return "count";
      case "unique":
        return `unique:${m.basis}`;
      case "sum":
        return `sum:${m.name}`;
      default:
        return assertNever(m);
    }
  },

  equals: (a: Measure, b: Measure): boolean => Measure.toKey(a) === Measure.toKey(b),
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
   * Collapse a series to one number, or `null` when there is nothing to
   * collapse.
   *
   * The `null` is the point. v2 returned 0 for every statistic on an empty
   * series, which is honest for a total — no events did happen — and a lie for
   * the other four: the peak of nothing is not zero, and neither is the latest
   * value. A monitor comparing "latest" against a floor would have fired on a
   * project that had simply not reported yet. Zero for `total` only.
   */
  apply: (stat: SummaryStat, series: readonly number[]): number | null => {
    if (series.length === 0) return stat === "total" ? 0 : null;
    const first = series[0] as number;
    switch (stat) {
      case "total":
        return series.reduce((a, b) => a + b, 0);
      case "average":
        return series.reduce((a, b) => a + b, 0) / series.length;
      case "peak":
        return series.reduce((a, b) => (b > a ? b : a), first);
      case "low":
        return series.reduce((a, b) => (b < a ? b : a), first);
      case "latest":
        return series[series.length - 1] as number;
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
   * Whether the statistic is meaningful only per bucket. "Average" needs a unit
   * to read sensibly — average per day, per hour — whereas a total does not.
   */
  isPerBucket: (stat: SummaryStat): boolean => stat === "average",
} as const;

export type TrendDirection = "up" | "down" | "flat";

/**
 * A number against the same number over the previous period.
 *
 * Everything here is a number. v1's `MetricData.value` was produced with
 * `toLocaleString()` inside the query layer and the trend calculation then did
 * `parseFloat(value.replace(/,/g, ""))` to get a number back out — presentation
 * had leaked into the domain payload and was being un-leaked by regex.
 * Formatting belongs to whatever renders this.
 */
export type Trend = {
  readonly current: number;
  readonly previous: number;
  /** current - previous. Always defined. */
  readonly absoluteChange: number;
  /**
   * Percentage change, or `null` when there is no baseline.
   *
   * Going from 0 to 100 is not "a 0% increase" and it is not infinite growth
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

  /** True when there was a baseline to compare against. */
  isComparable: (t: Trend): boolean => t.percentChange !== null,

  /**
   * Whether the movement is worth drawing attention to. Some metrics are better
   * when they fall — load time, error count — so the caller says which
   * direction is good rather than the domain assuming more is better.
   */
  isFavourable: (t: Trend, higherIsBetter: boolean): boolean => {
    if (t.direction === "flat") return false;
    return higherIsBetter ? t.direction === "up" : t.direction === "down";
  },
} as const;
