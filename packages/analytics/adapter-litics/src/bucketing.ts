/**
 * Bucket edges — which are litics', with one thing this adapter must get right.
 *
 * litics computes bucket edges and bins its own buckets. The domain must not
 * duplicate that calculation, or its edges can disagree with the stored data.
 * What is left here is the *alignment* the SQL needs, and it is not cosmetic.
 *
 * A summary row's bucket is `date_bin('1 hour', ts, 'epoch')` — every
 * summary bucket sits on an epoch-aligned boundary. A read then re-bins those
 * rows with `date_bin(<step>, c.bucket, <from>)`, where `<from>` is the same
 * bound parameter as the range start. So **the range start IS the binning
 * origin** and there is no way to pass a different one.
 *
 * Give it a `from` of 10:30 with a daily step and each bin covers
 * [10:30, next 10:30) — which contains exactly one day of summary buckets, the following
 * midnight. Every bucket in the series is then labelled with the day before
 * the data it holds. Nothing errors; the chart is silently off by one.
 *
 * So the adapter floors `from` onto the step's own calendar boundary in UTC
 * before it builds a query, and the same function floors each returned row
 * back onto that grid. One implementation, used twice, which is why the two
 * cannot drift.
 *
 * Weeks are Monday-based and months are calendar months, both in UTC. There is
 * no timezone parameter anywhere in Counted's analytics path and inventing one
 * here would put the display timezone inside the query planner.
 */

import { Instant } from "@counted/kernel";
import type { Step } from "@counted/analytics-ports";

/**
 * The Postgres interval literal for a step, or `null` for `month`.
 *
 * Months are `null` because litics' `intervalSeconds` only parses
 * second/minute/hour/day/week — a month has no fixed length, so binning
 * cannot divide by it and `date_bin` refuses month strides outright. Month
 * series are assembled from a finer step; see `monthSpans`.
 */
export const stepInterval = (step: Step): string | null => {
  switch (step) {
    case "hour":
      return "1 hour";
    case "day":
      return "1 day";
    case "week":
      return "7 days";
    case "month":
      return null;
  }
};

/** Milliseconds per step, for the three steps that have a fixed length. */
export const stepMillis = (step: Step): number | null => {
  switch (step) {
    case "hour":
      return 3_600_000;
    case "day":
      return 86_400_000;
    case "week":
      return 604_800_000;
    case "month":
      return null;
  }
};

/**
 * Floor an instant onto the step's UTC calendar boundary.
 *
 * Used for the query's `from` and for every row that comes back, so a returned
 * bucket always lands on a grid position that exists.
 */
export const alignFloor = (at: Instant, step: Step): Instant => {
  const d = new Date(Instant.toEpochMillis(at));
  switch (step) {
    case "hour":
      d.setUTCMinutes(0, 0, 0);
      return Instant.fromDate(d);
    case "day":
      d.setUTCHours(0, 0, 0, 0);
      return Instant.fromDate(d);
    case "week": {
      d.setUTCHours(0, 0, 0, 0);
      // getUTCDay: 0 = Sunday. Monday-based weeks, so Sunday walks back six.
      const back = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - back);
      return Instant.fromDate(d);
    }
    case "month":
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      return Instant.fromDate(d);
  }
};

/** The next grid position after `start`. Calendar-aware for months. */
export const advance = (start: Instant, step: Step): Instant => {
  const fixed = stepMillis(step);
  if (fixed !== null) return Instant.fromEpochMillis(Instant.toEpochMillis(start) + fixed);
  const d = new Date(Instant.toEpochMillis(start));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return Instant.fromDate(d);
};

/**
 * A ceiling on how many buckets one answer may contain.
 *
 * The analytics domain caps a window at 730 days, which is 17,520 hourly
 * buckets — legal, and already a payload no chart draws. The cap exists so a
 * caller that asks for something worse gets a refusal instead of the process
 * building a million-element array.
 */
export const MAX_BUCKETS = 20_000;

/**
 * Every bucket start in `[floor(from), to)`, in order, on the step's grid.
 *
 * Dense by construction: this is the list a `Series` must have one entry for,
 * including the zeroes. A sparse series is how a chart ends up with a gap
 * where it should have a floor.
 */
export const gridStarts = (from: Instant, to: Instant, step: Step): readonly Instant[] => {
  const starts: Instant[] = [];
  let cursor = alignFloor(from, step);
  const end = Instant.toEpochMillis(to);
  while (Instant.toEpochMillis(cursor) < end) {
    starts.push(cursor);
    if (starts.length > MAX_BUCKETS) return starts;
    const next = advance(cursor, step);
    // Defensive: `advance` is strictly increasing for every Step, and a
    // non-advancing cursor would spin forever rather than fail.
    if (Instant.toEpochMillis(next) <= Instant.toEpochMillis(cursor)) break;
    cursor = next;
  }
  return starts;
};

/**
 * The stride that puts the WHOLE window into a single bin, on the step's grid.
 *
 * A breakdown has no buckets — one number per dimension value, covering the
 * window — but litics' readers always bin, so the way to ask for one bucket is
 * a stride at least as long as the window. `date_bin` only ever labels bins
 * from the origin forward, and the origin is the range start, so everything in
 * `[origin, to)` lands in the first bin.
 *
 * Two constraints decide the number.
 *
 * The origin is `alignFloor(from, step)`, the same left edge a series would
 * have, because it is also the query's lower bound: floor it further and the
 * answer quietly includes hours nobody asked for.
 *
 * The stride is a whole number of hours or days, never something finer,
 * because litics bins on the hour grid. Days
 * for every step but `hour`, so a daily grid
 * can answer; hours for `hour`, which is what pins an hourly-grid question to
 * the hourly grid — the same trade a series makes.
 *
 * `null` when the window is empty or inverted, which the caller refuses.
 */
export const wholeWindowStride = (
  from: Instant,
  to: Instant,
  step: Step,
): { readonly origin: Instant; readonly interval: string } | null => {
  const origin = alignFloor(from, step);
  const originMillis = Instant.toEpochMillis(origin);
  const span = Instant.toEpochMillis(to) - originMillis;
  if (!Number.isFinite(span) || span <= 0) return null;

  // day, week and month all floor onto UTC midnight, so a stride in days is
  // aligned with a daily grid's own buckets.
  if (step !== "hour") return { origin, interval: `${Math.ceil(span / 86_400_000)} days` };

  const hours = Math.max(1, Math.ceil(span / 3_600_000));
  // An hourly-grid window can start anywhere. If its length happened to be a
  // whole number of days, the bins would sit on the daily grid — whose
  // buckets sit on midnight — and a range from 10:00 to 10:00 would then match
  // only the midnight bucket in the middle: a whole day of data reported for a
  // window that asked for two halves of two different ones. Nothing errors.
  //
  // One extra hour of stride breaks the divisibility, so only the hourly grid
  // qualifies. It reads nothing extra: the stride decides how rows are binned,
  // the WHERE clause decides which rows there are.
  const dayAligned = originMillis % 86_400_000 === 0;
  const stride = !dayAligned && hours % 24 === 0 ? hours + 1 : hours;
  return { origin, interval: `${stride} hours` };
};

/**
 * A calendar month inside the requested bounds, clipped to them.
 *
 * `days` is the whole month's length, which is what a month query passes as
 * its step: `date_bin('31 days', bucket, <month start>)` puts everything in
 * the month into a single bin, and 31 (or 28, or 30) days is a whole number of
 * daily *and* hourly summary buckets.
 */
export type MonthSpan = {
  /** First instant of the calendar month, UTC. Also the binning origin. */
  readonly start: Instant;
  /** Where the month's data stops: the next month, or the window's end. */
  readonly to: Instant;
  readonly days: number;
};

/** The calendar months touched by `[from, to)`, clipped, in order. */
export const monthSpans = (from: Instant, to: Instant): readonly MonthSpan[] => {
  const spans: MonthSpan[] = [];
  for (const start of gridStarts(from, to, "month")) {
    const next = advance(start, "month");
    spans.push({
      start,
      // The low end is NOT clipped to the requested `from`. A month bucket is
      // a whole month, exactly as an hour bucket is a whole hour — the range
      // start is already floored onto the grid for every other step, and doing
      // it differently here would make the first month of a series mean
      // something the other eleven do not.
      to: Instant.min(next, to),
      days: Math.round((Instant.toEpochMillis(next) - Instant.toEpochMillis(start)) / 86_400_000),
    });
  }
  return spans;
};

/**
 * Fold rows onto the grid, filling every position the engine did not return.
 *
 * Rows are floored rather than matched exactly. An exact match would drop a
 * row whose timestamp is a millisecond off the grid — and dropping a row is
 * invisible, whereas the number simply being wrong is not. Flooring cannot
 * lose a row that is inside the range.
 *
 * Rows landing on the same position are SUMMED, which the month roll-up
 * depends on: a monthly count series is one daily-step query whose rows are
 * folded into calendar months here. That fold is only valid because counts and
 * measure sums are additive — an HLL cardinality is not, which is why monthly
 * uniques are one query per month instead.
 */
export const densify = (
  starts: readonly Instant[],
  step: Step,
  rows: readonly { readonly at: Instant; readonly value: number }[],
): readonly { readonly start: Instant; readonly value: number }[] => {
  const byStart = new Map<number, number>();
  for (const row of rows) {
    const key = Instant.toEpochMillis(alignFloor(row.at, step));
    byStart.set(key, (byStart.get(key) ?? 0) + row.value);
  }
  return starts.map((start) => ({
    start,
    value: byStart.get(Instant.toEpochMillis(start)) ?? 0,
  }));
};
