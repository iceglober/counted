/**
 * Retention — how many of the people who first appeared in one period came
 * back in later ones.
 *
 * This is the feature v1 could not honestly ship. Its cohorts were keyed on
 * `session_id`, and a session ends after 30 minutes of idle, so a session id
 * essentially never appeared in two different day or week buckets: every
 * cohort past period 0 was ~0 by construction, under a column header reading
 * "Users". The privacy model forbade the identity retention needs, and the
 * feature shipped anyway.
 *
 * Two structural fixes:
 *
 *   1. **Retention is person-scoped, always.** `basis` is the literal type
 *      `"person"`, so a visit-scoped retention cannot be constructed. Without
 *      an `identify()` call there is no such thing as coming back, and we say
 *      so rather than drawing an empty grid.
 *
 *   2. **Offsets are calendar positions, not array indices.** v1 collected the
 *      periods that happened to contain activity, sorted them, and read offset
 *      `k` as `sortedPeriods[firstIdx + k]`. A period with no activity anywhere
 *      in the project simply vanished from that array, so every later column
 *      shifted left and a cohort's "+3" silently displayed week 5's number.
 *      Here an offset is `step()` applied `k` times from the cohort start.
 *
 * A third distinction v1 collapsed: a cell that is **not yet observable** —
 * a cohort from three days ago cannot have a +7 figure — is `null`, not zero.
 * Zero means people were asked and did not come back. Those are different
 * facts and a chart that conflates them is lying about the recent cohorts.
 */

import { err, ok, type Result } from "../shared/result";
import { Instant } from "../shared/instant";
import { step, truncTo, type Weekday, DEFAULT_WEEK_START } from "./time-axis";
import type { Predicate } from "./predicate";
import type { Grain, Window } from "./window";

export type Retention = {
  /** Which cohorts to include: those whose first activity falls in here. */
  readonly window: Window;
  /** Cohort period size, and the unit an offset counts in. */
  readonly grain: Grain;
  /** How many follow-up periods to report, beyond period 0. */
  readonly periods: number;
  /**
   * Always "person". Retention is unanswerable on ephemeral visits, and this
   * literal type is what stops it being asked.
   */
  readonly basis: "person";
  /** What counts as joining a cohort. Absent means any event. */
  readonly startEvents?: readonly string[];
  /** What counts as coming back. Absent means the same as `startEvents`. */
  readonly returnEvents?: readonly string[];
  readonly where?: Predicate;
  readonly weekStart?: Weekday;
};

export type RetentionError =
  | { kind: "NonPositivePeriods"; periods: number }
  | { kind: "TooManyPeriods"; periods: number; max: number }
  | { kind: "EmptyEventName" };

export const MAX_RETENTION_PERIODS = 60;

/**
 * One cell. `null` where the period has not been reached yet — see the note
 * above about not conflating "unknowable" with "nobody returned".
 */
export type RetentionCell = {
  readonly offset: number;
  readonly returned: number;
  readonly rate: number;
} | null;

export type RetentionCohort = {
  readonly start: Instant;
  /** People whose first activity fell in this period. */
  readonly size: number;
  /** Length is always `periods + 1`; trailing entries may be null. */
  readonly cells: readonly RetentionCell[];
};

export type RetentionGrid = {
  readonly grain: Grain;
  /** Column offsets, `0..periods`. Always the full width. */
  readonly offsets: readonly number[];
  readonly cohorts: readonly RetentionCohort[];
};

/** What the store returns: one row per observed (cohort, period) pair. */
export type RetentionObservation = {
  readonly cohortStart: Instant;
  readonly periodStart: Instant;
  readonly returned: number;
};

export type CohortSize = { readonly cohortStart: Instant; readonly size: number };

export const Retention = {
  of: (
    window: Window,
    grain: Grain,
    periods: number,
    options: Omit<Retention, "window" | "grain" | "periods" | "basis"> = {},
  ): Retention => ({ window, grain, periods, basis: "person", ...options }),

  /** The events that define coming back, defaulting to the joining events. */
  returnEvents: (r: Retention): readonly string[] | undefined =>
    r.returnEvents ?? r.startEvents,

  validate: (r: Retention): Result<Retention, RetentionError> => {
    if (r.periods <= 0) return err({ kind: "NonPositivePeriods", periods: r.periods });
    if (r.periods > MAX_RETENTION_PERIODS) {
      return err({ kind: "TooManyPeriods", periods: r.periods, max: MAX_RETENTION_PERIODS });
    }
    for (const name of [...(r.startEvents ?? []), ...(r.returnEvents ?? [])]) {
      if (name.trim().length === 0) return err({ kind: "EmptyEventName" });
    }
    return ok(r);
  },

  /**
   * The instant at which offset `k` begins for a cohort — `step()` applied k
   * times, so it walks the calendar and a month offset is a real month.
   */
  periodStartFor: (r: Retention, cohortStart: Instant, offset: number): Instant => {
    let cursor = cohortStart;
    for (let i = 0; i < offset; i++) cursor = step(r.grain, cursor);
    return cursor;
  },

  /**
   * Which offset a period belongs to for a given cohort, or null if it is
   * before the cohort or past the reported width. Calendar-walked, never
   * derived from the position of a value in an array.
   */
  offsetOf: (
    r: Retention,
    cohortStart: Instant,
    periodStart: Instant,
  ): number | null => {
    if (periodStart < cohortStart) return null;
    let cursor = cohortStart;
    for (let k = 0; k <= r.periods; k++) {
      if (cursor === periodStart) return k;
      if (cursor > periodStart) return null;
      cursor = step(r.grain, cursor);
    }
    return null;
  },

  /**
   * Assemble the grid.
   *
   * Every cohort gets the full `periods + 1` columns. A column is `null` when
   * its period has not begun as of `now`, and a real zero when it has begun
   * and nobody returned.
   */
  buildGrid: (
    r: Retention,
    sizes: readonly CohortSize[],
    observations: readonly RetentionObservation[],
    now: Instant,
  ): RetentionGrid => {
    const weekStart = r.weekStart ?? DEFAULT_WEEK_START;
    const currentPeriod = truncTo(r.grain, now, weekStart);

    // (cohortStart -> offset -> returned)
    const byCohort = new Map<number, Map<number, number>>();
    for (const o of observations) {
      const offset = Retention.offsetOf(r, o.cohortStart, o.periodStart);
      if (offset === null) continue;
      const key = Instant.toEpochMillis(o.cohortStart);
      const inner = byCohort.get(key) ?? new Map<number, number>();
      inner.set(offset, (inner.get(offset) ?? 0) + o.returned);
      byCohort.set(key, inner);
    }

    const cohorts = [...sizes]
      .sort((a, b) => Instant.compare(a.cohortStart, b.cohortStart))
      .map((c): RetentionCohort => {
        const observed = byCohort.get(Instant.toEpochMillis(c.cohortStart));
        const cells: RetentionCell[] = [];

        for (let k = 0; k <= r.periods; k++) {
          const periodStart = Retention.periodStartFor(r, c.cohortStart, k);
          // A period that has not started yet is unknowable, not zero.
          if (periodStart > currentPeriod) {
            cells.push(null);
            continue;
          }
          const returned = observed?.get(k) ?? 0;
          cells.push({
            offset: k,
            returned,
            rate: c.size === 0 ? 0 : (returned / c.size) * 100,
          });
        }

        return { start: c.cohortStart, size: c.size, cells };
      });

    return {
      grain: r.grain,
      offsets: Array.from({ length: r.periods + 1 }, (_, k) => k),
      cohorts,
    };
  },

  /**
   * Average rate at one offset across every cohort that can answer it. Skips
   * unknowable cells rather than counting them as zero, which is what makes
   * the number comparable between offsets.
   */
  averageRateAt: (grid: RetentionGrid, offset: number): number | null => {
    let total = 0;
    let counted = 0;
    for (const cohort of grid.cohorts) {
      const cell = cohort.cells[offset];
      if (cell === undefined || cell === null) continue;
      total += cell.rate;
      counted++;
    }
    return counted === 0 ? null : total / counted;
  },
} as const;
