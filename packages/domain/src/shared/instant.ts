/**
 * Instant — a point on the UTC timeline, as epoch milliseconds.
 *
 * Not a `Date`. `Date` is mutable, carries a local-timezone presentation that
 * has no business inside the domain, and tempts callers into `Date.now()`.
 * Converting to and from `Date` happens at the adapter boundary.
 *
 * Time enters the domain as a value from `Clock`, never by reading the machine
 * clock. That is what makes the whole layer testable without freezing global
 * state, and it is enforced: `domain-has-no-io` in .dependency-cruiser.cjs
 * forbids Node builtins here.
 */

import type { Brand } from "./brand";
import { Duration } from "./duration";

export type Instant = Brand<number, "Instant">;

const of = (epochMillis: number): Instant => epochMillis as Instant;

export const Instant = {
  fromEpochMillis: (n: number): Instant => of(n),
  toEpochMillis: (i: Instant): number => i,

  /** Boundary helpers. Use these in adapters, not in domain logic. */
  fromDate: (d: Date): Instant => of(d.getTime()),
  toDate: (i: Instant): Date => new Date(i),

  /** ISO-8601 in UTC. The only string form the domain acknowledges. */
  toISO: (i: Instant): string => new Date(i).toISOString(),

  plus: (i: Instant, d: Duration): Instant => of(i + Duration.toMillis(d)),
  minus: (i: Instant, d: Duration): Instant => of(i - Duration.toMillis(d)),

  /** Signed span from `a` to `b`. Negative when `b` precedes `a`. */
  between: (a: Instant, b: Instant): Duration => Duration.millis(b - a),

  compare: (a: Instant, b: Instant): number => a - b,
  isBefore: (a: Instant, b: Instant): boolean => a < b,
  isAfter: (a: Instant, b: Instant): boolean => a > b,
  equals: (a: Instant, b: Instant): boolean => a === b,

  min: (a: Instant, b: Instant): Instant => (a <= b ? a : b),
  max: (a: Instant, b: Instant): Instant => (a >= b ? a : b),

  EPOCH: of(0),
} as const;

/**
 * Clock — the port through which time reaches the domain.
 *
 * Declared here because the domain is what needs it; an implementation lives in
 * an adapter. A test supplies a fixed or scripted clock and gets deterministic
 * behaviour with no global patching.
 */
export interface Clock {
  now(): Instant;
}

/** A clock frozen at one instant. For tests and for deterministic replay. */
export const fixedClock = (at: Instant): Clock => ({ now: () => at });

/**
 * A clock that advances only when told to. Lets a test express "an hour passes"
 * without sleeping or touching global state.
 */
export const scriptedClock = (start: Instant): Clock & { advance(by: Duration): void } => {
  let current = start;
  return {
    now: () => current,
    advance(by: Duration) {
      current = Instant.plus(current, by);
    },
  };
};
