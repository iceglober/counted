/**
 * Three ideas that v1 blurred into overlapping strings, kept apart by having
 * three names and three incompatible types.
 *
 *   `Window`            the interval an analysis observes.
 *   `Grain`             how finely that interval is cut into buckets.
 *   `ConversionWindow`  how long a funnel gives someone to finish.
 *
 * v1 had `TimeRange` for the first, `timeBucket` *and* a separate
 * `groupBy: {type:"time"}` with its own SQL for the second, and for the third
 * `alerts.window` — free text like `"1h"`, parsed by a regex that silently fell
 * back to one hour for anything it did not recognise, so a monitor configured
 * for `"1w"` quietly measured the last hour. None of the three are assignable
 * to each other here, so that substitution is a compile error.
 *
 * Bucket *edges* are no longer ours. v2's domain computed them and handed them
 * to SQL; litics computes its own from the hour grid and the query step, and
 * the rule that mattered — exactly one bucketing implementation — survives by
 * moving rather than by being duplicated. What this module still owns is
 * resolving a relative window into absolute bounds, because that is calendar
 * arithmetic on a caller-supplied `now`, not bucketing.
 */

import { assertNever, Duration, Instant } from "@counted/kernel";

export type Grain = "hour" | "day" | "week" | "month";

export const GRAINS: readonly Grain[] = ["hour", "day", "week", "month"];

export const isGrain = (raw: string): raw is Grain =>
  (GRAINS as readonly string[]).includes(raw);

export const Grain = {
  /**
   * A nominal length, for ordering grains and rough sizing. NOT for arithmetic
   * on real dates — a month is a boundary, not a length. Calendar walking is
   * `resolveWindow` below and, for buckets, the engine's.
   */
  nominal: (g: Grain): Duration => {
    switch (g) {
      case "hour":
        return Duration.hours(1);
      case "day":
        return Duration.days(1);
      case "week":
        return Duration.days(7);
      case "month":
        return Duration.days(30);
      default:
        return assertNever(g);
    }
  },

  isCoarserThan: (a: Grain, b: Grain): boolean =>
    Duration.toMillis(Grain.nominal(a)) > Duration.toMillis(Grain.nominal(b)),

  label: (g: Grain): string => {
    switch (g) {
      case "hour":
        return "Hourly";
      case "day":
        return "Daily";
      case "week":
        return "Weekly";
      case "month":
        return "Monthly";
      default:
        return assertNever(g);
    }
  },
} as const;

export type RelativeUnit = "hour" | "day" | "week" | "month";

/**
 * Either anchored to "now" or to fixed instants.
 *
 * A relative window is resolved against a clock at *execution* time, never at
 * definition time. That is what lets a saved dashboard tile and a standing
 * monitor share one stored definition: "last 7 days" means something different
 * every time it runs, and it has to.
 */
export type Window =
  | { readonly kind: "relative"; readonly amount: number; readonly unit: RelativeUnit }
  | { readonly kind: "absolute"; readonly from: Instant; readonly to: Instant };

export type Bounds = { readonly from: Instant; readonly to: Instant };

/**
 * The longest interval a single analysis may observe.
 *
 * Two years. A ceiling exists so a pathological window is refused before it
 * reaches the engine, where it becomes a timeout that looks like an outage.
 */
export const MAX_WINDOW: Duration = Duration.days(730);

/** Upper bound on a calendar month, used only for the pre-resolution size check. */
const LONGEST_MONTH_MILLIS = Duration.toMillis(Duration.days(31));

export const Window = {
  lastHours: (n: number): Window => ({ kind: "relative", amount: n, unit: "hour" }),
  lastDays: (n: number): Window => ({ kind: "relative", amount: n, unit: "day" }),
  lastWeeks: (n: number): Window => ({ kind: "relative", amount: n, unit: "week" }),
  lastMonths: (n: number): Window => ({ kind: "relative", amount: n, unit: "month" }),
  between: (from: Instant, to: Instant): Window => ({ kind: "absolute", from, to }),

  isRelative: (w: Window): boolean => w.kind === "relative",

  toKey: (w: Window): string => {
    switch (w.kind) {
      case "relative":
        return `rel:${w.amount}${w.unit}`;
      case "absolute":
        return `abs:${Instant.toEpochMillis(w.from)}-${Instant.toEpochMillis(w.to)}`;
      default:
        return assertNever(w);
    }
  },

  /**
   * The largest span this window can cover, without a clock.
   *
   * Months are counted at 31 days here — the longest one — because this feeds
   * the "is it too large" refusal and an over-estimate refuses a shade too
   * eagerly, while an under-estimate lets a two-year-plus window through. The
   * exact span, once a clock exists, comes from `resolveWindow`.
   */
  maximumSpan: (w: Window): Duration => {
    if (w.kind === "absolute") return Instant.between(w.from, w.to);
    switch (w.unit) {
      case "hour":
        return Duration.hours(w.amount);
      case "day":
        return Duration.days(w.amount);
      case "week":
        return Duration.days(w.amount * 7);
      case "month":
        return Duration.millis(w.amount * LONGEST_MONTH_MILLIS);
      default:
        return assertNever(w.unit);
    }
  },

  /**
   * A grain that gives a readable number of buckets. Callers may override; this
   * exists so the default is in one place rather than scattered through the UI.
   */
  defaultGrain: (w: Window): Grain => {
    if (w.kind === "relative") {
      if (w.unit === "hour") return "hour";
      if (w.unit === "day") return w.amount <= 2 ? "hour" : w.amount <= 60 ? "day" : "week";
      if (w.unit === "week") return w.amount <= 12 ? "day" : "week";
      return w.amount <= 3 ? "day" : "month";
    }
    const span = Duration.toMillis(Instant.between(w.from, w.to));
    if (span <= Duration.toMillis(Duration.days(2))) return "hour";
    if (span <= Duration.toMillis(Duration.days(60))) return "day";
    if (span <= Duration.toMillis(Duration.days(365))) return "week";
    return "month";
  },
} as const;

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

/**
 * Resolve a window into absolute bounds against a caller-supplied instant.
 *
 * `now` is a parameter, never a read. The application reads the clock once and
 * passes the same instant to every analysis in a dashboard load; an engine or a
 * domain that read its own would let two tiles on one screen silently cover
 * different intervals.
 *
 * Everything is UTC. Per-workspace time zones are a real follow-up and this is
 * the seam: only this function and the engine's bucketing would need a zone.
 */
export const resolveWindow = (w: Window, now: Instant): Bounds => {
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

/**
 * The window immediately before this one, of comparable length.
 *
 * v1 derived the prior period by subtracting a millisecond span in which a
 * month was a flat 30 days, so every month-over-month comparison was off by up
 * to 3.3%, silently, forever. Here a relative window has the same *calendar*
 * shift applied a second time, so "the month before last month" is a real
 * month. An absolute window mirrors its span backwards from its start.
 *
 * The result is always absolute: a previous period is a fixed stretch of
 * history, and it must not drift as the clock moves under it.
 */
export const previousWindow = (w: Window, now: Instant): Window => {
  const { from, to } = resolveWindow(w, now);

  if (w.kind === "absolute") {
    const span = Instant.toEpochMillis(to) - Instant.toEpochMillis(from);
    return Window.between(Instant.fromEpochMillis(Instant.toEpochMillis(from) - span), from);
  }

  return Window.between(resolveWindow(w, from).from, from);
};

/**
 * How long a funnel gives someone to get from the first step to the last.
 *
 * A wrapper rather than a bare `Duration`, and that is the whole point: the
 * conversion window is not the observation window and is not a grain, and none
 * of the three can be passed where another is expected. Without it a funnel is
 * a set-membership question — which is exactly what v1 was computing while its
 * doc-comment claimed "performed each step in sequence".
 */
export type ConversionWindow = { readonly within: Duration };

export const ConversionWindow = {
  of: (within: Duration): ConversionWindow => ({ within }),
  toDuration: (c: ConversionWindow): Duration => c.within,
  toMillis: (c: ConversionWindow): number => Duration.toMillis(c.within),
  isPositive: (c: ConversionWindow): boolean => Duration.toMillis(c.within) > 0,
  toKey: (c: ConversionWindow): string => `cw:${Duration.toMillis(c.within)}`,

  /** The engine's own default when a funnel does not state one. */
  DEFAULT: { within: Duration.days(7) } as ConversionWindow,
} as const;
