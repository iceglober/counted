/**
 * Duration — a fixed span of time, in milliseconds.
 *
 * Fixed is the operative word. A Duration is exact arithmetic and knows nothing
 * about calendars: there is no `Duration.months`, because a month is not a
 * length, it is a boundary that depends on where you start. Calendar arithmetic
 * lives in the time axis, where the surrounding date is available.
 *
 * The old system got this wrong in a way worth remembering: it treated a month
 * as a flat 30 days for previous-period trends, so every month-over-month
 * comparison was off by up to 3.3%.
 */

import type { Brand } from "./brand";

export type Duration = Brand<number, "Duration">;

const of = (millis: number): Duration => millis as Duration;

export const Duration = {
  millis: (n: number): Duration => of(n),
  seconds: (n: number): Duration => of(n * 1_000),
  minutes: (n: number): Duration => of(n * 60_000),
  hours: (n: number): Duration => of(n * 3_600_000),
  /** Exactly 24 hours. Not "a calendar day" — those differ across DST. */
  days: (n: number): Duration => of(n * 86_400_000),

  toMillis: (d: Duration): number => d,
  toSeconds: (d: Duration): number => d / 1_000,

  add: (a: Duration, b: Duration): Duration => of(a + b),
  subtract: (a: Duration, b: Duration): Duration => of(a - b),
  multiply: (d: Duration, factor: number): Duration => of(d * factor),

  compare: (a: Duration, b: Duration): number => a - b,
  isZero: (d: Duration): boolean => d === 0,
  isNegative: (d: Duration): boolean => d < 0,

  ZERO: of(0),
} as const;
