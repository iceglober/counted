/**
 * Instant — a point on the UTC timeline, as epoch milliseconds.
 *
 * Not a `Date`. `Date` is mutable, carries a local-timezone presentation that
 * has no business inside the domain, and tempts callers into `Date.now()`.
 * Converting to and from `Date` happens at the adapter boundary.
 *
 * Time enters the domain as a value, never by reading the machine clock. That
 * is what makes the whole layer testable without freezing global state, and it
 * is enforced: the `domain-is-pure` rule in .dependency-cruiser.cjs forbids
 * Node builtins there, and `Clock` lives in ./ports which no domain may import.
 */

import type { Brand } from "./brand";
import { Duration } from "./duration";
import { err, ok, type Result } from "./result";

export type Instant = Brand<number, "Instant">;

const of = (epochMillis: number): Instant => epochMillis as Instant;

/**
 * The range `Date` can represent: ±100,000,000 days from the epoch. Outside it
 * `toISOString()` throws a RangeError, so every conversion in this module would
 * become a throwing call rather than a total function.
 */
const MAX_EPOCH_MILLIS = 8.64e15;

export type InstantParseError = { readonly kind: "NotAnInstant"; readonly raw: string };

/** True for a finite, in-range epoch-millisecond value. */
export const isInstant = (value: unknown): value is Instant =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= MAX_EPOCH_MILLIS;

export const Instant = {
  /**
   * Trusts its argument. Every caller is an adapter that just read a timestamp
   * column or a monotonic clock; validating there would be validating twice.
   * Use `isInstant` when the number came from outside.
   */
  fromEpochMillis: (n: number): Instant => of(n),
  toEpochMillis: (i: Instant): number => i,

  /** Boundary helpers. Use these in adapters, not in domain logic. */
  fromDate: (d: Date): Instant => of(d.getTime()),
  toDate: (i: Instant): Date => new Date(i),

  /** ISO-8601 in UTC. The only string form the domain acknowledges. */
  toISO: (i: Instant): string => new Date(i).toISOString(),

  /**
   * Parse ISO-8601. Fallible, and says so: this is where a request body or a
   * config file crosses into the domain, and "the string was not a timestamp"
   * is a real outcome the caller has to handle rather than a thrown surprise.
   */
  fromISO: (raw: string): Result<Instant, InstantParseError> => {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_EPOCH_MILLIS) {
      return err({ kind: "NotAnInstant", raw });
    }
    return ok(of(parsed));
  },

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
