/**
 * Readout — the computed answer to a tile's question.
 *
 * Transient by design. It is never persisted alongside the tile, which is the
 * structural difference from v1's `Insight.data`: there the answer lived on the
 * same object as the definition, so a stored dashboard carried stale numbers
 * and every consumer had to know whether the `data` it was holding had been
 * refreshed.
 *
 * A readout is also explicitly fallible, and there is no "empty" variant a
 * failed query can quietly become. v1's loader wrapped everything in
 * `Promise.allSettled` and turned any rejection into `emptyData()`, so a broken
 * query and a genuinely empty project rendered identically — a customer could
 * not tell "you have no traffic" from "we could not ask".
 *
 * The shapes below are the *answer* shapes a tile draws, deliberately spelled
 * out here rather than imported: `Series` and `FunnelCounts` in
 * `@counted/analytics-ports` are what an engine returns, which is a different
 * concern from what a card renders, and the domain may not import a ports
 * package anyway. The translation happens in `@counted/dashboarding-app`.
 */

import type { Brand, Instant } from "@counted/kernel";

/**
 * What an answer belongs to.
 *
 * A tile id, usually — but a monitor asks the same question through the same
 * path, and its answer is not a tile's. Keeping this an opaque correlation id
 * rather than a `TileId` is what lets those two share one query path without
 * either pretending to be the other.
 */
export type ReadoutId = Brand<string, "ReadoutId">;
export const ReadoutId = (raw: string): ReadoutId => raw as ReadoutId;

export type SeriesPoint = { readonly bucketStart: Instant; readonly value: number };

export type ReadoutValue =
  | { readonly shape: "scalar"; readonly value: number }
  | { readonly shape: "series"; readonly points: readonly SeriesPoint[] }
  | {
      readonly shape: "breakdown";
      readonly rows: readonly { readonly label: string; readonly value: number }[];
    }
  | { readonly shape: "funnel"; readonly counts: readonly number[] };

/**
 * Why there is no answer. `retriable` is the field the console acts on: a
 * timeout gets a retry button, an unsupported analysis does not.
 */
export type ReadoutFailure = {
  readonly code: "timeout" | "unsupported" | "engine_unavailable" | "invalid_request";
  readonly detail: string;
  readonly retriable: boolean;
};

/** Either an answer or a stated reason there is none. Never a silent blank. */
export type Readout =
  | {
      readonly id: ReadoutId;
      readonly ok: true;
      readonly value: ReadoutValue;
      readonly computedAt: Instant;
    }
  | { readonly id: ReadoutId; readonly ok: false; readonly failure: ReadoutFailure };

export const Readout = {
  answered: (id: ReadoutId, value: ReadoutValue, computedAt: Instant): Readout => ({
    id,
    ok: true,
    value,
    computedAt,
  }),
  failed: (id: ReadoutId, failure: ReadoutFailure): Readout => ({ id, ok: false, failure }),
} as const;
