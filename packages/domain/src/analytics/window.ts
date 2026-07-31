/**
 * Window — the interval an analysis observes, and Grain — how finely it is cut.
 *
 * Three separate ideas that v1 blurred into overlapping strings: the
 * observation interval (`TimeRange`), the bucket size (`timeBucket` on the
 * query, but also `groupBy: {type:"time"}` with its own separate SQL), and an
 * alert's lookback (`alerts.window` as free text like `"1h"`, parsed by a
 * regex that silently fell back to one hour for anything it did not recognise
 * — so a monitor configured for `"1w"` quietly measured the last hour).
 *
 * Bucket *edges* are computed in the time axis (#23). This module only says
 * what was asked for.
 */

import { assertNever } from "../shared/brand";
import { Duration } from "../shared/duration";
import { Instant } from "../shared/instant";

export type Grain = "hour" | "day" | "week" | "month";

export const GRAINS: readonly Grain[] = ["hour", "day", "week", "month"];

export const Grain = {
  /**
   * A nominal length, for ordering grains and for rough sizing. NOT for
   * arithmetic on real dates — a month is a boundary, not a length, and the
   * time axis walks the calendar properly.
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
} as const;

export type RelativeUnit = "hour" | "day" | "week" | "month";

/**
 * A window is either anchored to "now" or to fixed instants. Relative windows
 * are resolved against a Clock at execution time, never at definition time —
 * that is what lets a saved dashboard tile and a standing monitor share one
 * definition.
 */
export type Window =
  | { readonly kind: "relative"; readonly amount: number; readonly unit: RelativeUnit }
  | { readonly kind: "absolute"; readonly from: Instant; readonly to: Instant };

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
   * The grain that gives a readable number of buckets for this window. Callers
   * may override; this exists so a sensible default is one place rather than
   * scattered across UI code.
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
