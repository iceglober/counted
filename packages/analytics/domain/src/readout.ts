/**
 * Readout — the computed answer to an analysis, and the one place a failure
 * cannot turn into a blank.
 *
 * Transient by design. A readout is never persisted alongside the tile that
 * asked for it, which is the structural difference from v1's `Insight.data`:
 * there the answer lived on the same row as the definition, so a stored
 * dashboard carried stale numbers and every consumer had to know whether the
 * `data` it was holding had been refreshed. Here there is nowhere to store one.
 *
 * `Outcome<T>` has **no zero value**. There is no empty variant a failed query
 * can quietly become, and no constructor that produces one. v1's loader wrapped
 * its fan-out in `Promise.allSettled` and mapped every rejection to
 * `emptyData()`, so a broken query and a genuinely empty project rendered
 * identically and nobody looking at the screen could tell which they had. A
 * caller here must read `ok` before it can reach a value, and the compiler
 * enforces that.
 */

import { assertNever, type Brand, type Duration, type Instant } from "@counted/kernel";
import type { FunnelResult } from "./funnel";
import type { Trend } from "./measure";

/**
 * What an answer belongs to.
 *
 * A tile id, usually — but a monitor asks the same questions through the same
 * planner, and its answer is not a tile's. An opaque correlation id rather than
 * a `TileId` is what lets those two share one query path without either
 * pretending to be the other.
 */
export type ReadoutId = Brand<string, "ReadoutId">;
export const ReadoutId = (raw: string): ReadoutId => raw as ReadoutId;

/**
 * The capabilities the engine does not have.
 *
 * Structurally identical to `MissingFeature` in `@counted/analytics-ports`, and
 * that is deliberate rather than sloppy: a domain may not import a ports
 * package, so the two unions cannot be one declaration — but keeping them the
 * same string union means an `EngineFailure` assigns straight into a
 * `ReadoutFailure` with no mapping layer to drift out of sync. If one changes,
 * change both; the app layer stops compiling if you do not.
 */
export type MissingCapability = "retention" | "group_by" | "nested_predicates";

export type SeriesPoint = { readonly bucketStart: Instant; readonly value: number };

export type BreakdownRow = { readonly label: string; readonly value: number };

export type ReadoutValue =
  | { readonly shape: "scalar"; readonly value: number; readonly trend?: Trend }
  | { readonly shape: "series"; readonly points: readonly SeriesPoint[]; readonly trend?: Trend }
  | { readonly shape: "breakdown"; readonly rows: readonly BreakdownRow[] }
  | { readonly shape: "funnel"; readonly result: FunnelResult };

/**
 * Why there is no answer.
 *
 * Deliberately the same four kinds, with the same payloads, as `EngineFailure`
 * in `@counted/analytics-ports`. V3-SPEC §6 maps them onto 504, 503, 422 and
 * 501 respectively — `Timeout` to 504 and not 408, because the caller's request
 * was fine and it was the engine that did not answer in time. 408 would tell
 * the client *it* was slow, which is a different instruction.
 */
export type ReadoutFailure =
  | { readonly kind: "Timeout"; readonly budget: Duration }
  | { readonly kind: "Unavailable"; readonly detail: string }
  | { readonly kind: "InvalidQuery"; readonly detail: string }
  | { readonly kind: "NotImplemented"; readonly feature: MissingCapability };

/**
 * Either an answer or a stated reason there is none. Never a silent blank.
 *
 * Generic so the same discipline covers the intermediate values the app layer
 * assembles a readout from — a bare series, a funnel's counts — and not only
 * the finished thing.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T; readonly computedAt: Instant }
  | { readonly ok: false; readonly failure: ReadoutFailure };

export const Outcome = {
  answered: <T>(value: T, computedAt: Instant): Outcome<T> => ({ ok: true, value, computedAt }),
  failed: <T>(failure: ReadoutFailure): Outcome<T> => ({ ok: false, failure }),

  map: <T, U>(o: Outcome<T>, f: (value: T) => U): Outcome<U> =>
    o.ok ? { ok: true, value: f(o.value), computedAt: o.computedAt } : o,

  /**
   * No `unwrapOr`. A fallback is exactly the zero value this type exists to
   * refuse; if you want one, you are about to render a failure as data.
   */
  isAnswered: <T>(o: Outcome<T>): o is Extract<Outcome<T>, { ok: true }> => o.ok,
} as const;

export type Readout = { readonly id: ReadoutId } & Outcome<ReadoutValue>;

export const Readout = {
  answered: (id: ReadoutId, value: ReadoutValue, computedAt: Instant): Readout => ({
    id,
    ...Outcome.answered(value, computedAt),
  }),

  failed: (id: ReadoutId, failure: ReadoutFailure): Readout => ({
    id,
    ...Outcome.failed<ReadoutValue>(failure),
  }),

  /**
   * Whether retrying could produce a different answer. A timeout or an
   * unavailable engine might; a malformed query and a missing capability never
   * will, and retrying them is how a dashboard becomes a load generator.
   */
  isRetriable: (failure: ReadoutFailure): boolean => {
    switch (failure.kind) {
      case "Timeout":
      case "Unavailable":
        return true;
      case "InvalidQuery":
      case "NotImplemented":
        return false;
      default:
        return assertNever(failure);
    }
  },

  /** The shape the answer has, for a renderer that must pick a chart. */
  shapeOf: (value: ReadoutValue): ReadoutValue["shape"] => value.shape,
} as const;
