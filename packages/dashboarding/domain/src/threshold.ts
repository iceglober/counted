/**
 * Threshold — what counts as bad, as a number.
 *
 * Its own module because both `Monitor` and `MonitorEvent` need it, and having
 * the event union reach into the aggregate for it is a cycle: types or not,
 * `no-circular` counts it, and a graph with a loop has no innermost package to
 * layer from.
 *
 * v1 stored the threshold as text "for precision" and recovered it with
 * `parseFloat` on every evaluation, so a value that failed to parse compared as
 * `NaN` and the monitor silently never fired.
 */

import { assertNever } from "@counted/kernel";

export type Threshold =
  | { readonly comparison: "above"; readonly value: number }
  | { readonly comparison: "below"; readonly value: number };

export const Threshold = {
  above: (value: number): Threshold => ({ comparison: "above", value }),
  below: (value: number): Threshold => ({ comparison: "below", value }),

  /** Strict on both sides: `above 10` is not breached by exactly 10. */
  isBreached: (t: Threshold, observed: number): boolean => {
    switch (t.comparison) {
      case "above":
        return observed > t.value;
      case "below":
        return observed < t.value;
      default:
        return assertNever(t);
    }
  },

  equals: (a: Threshold, b: Threshold): boolean =>
    a.comparison === b.comparison && a.value === b.value,

  describe: (t: Threshold): string =>
    t.comparison === "above" ? `above ${t.value}` : `below ${t.value}`,
} as const;
