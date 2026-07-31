/**
 * Readout — the computed answer to a tile's question.
 *
 * Transient by design. It is never persisted alongside the tile, which is the
 * structural difference from v1's `Insight.data`: there, the answer lived on
 * the same object as the definition, so a stored dashboard carried stale
 * numbers and every consumer had to know whether the `data` it was holding had
 * been refreshed.
 *
 * A readout is also explicitly fallible. There is no "empty" variant that a
 * failed query can quietly become — v1's loader wrapped everything in
 * Promise.allSettled and turned any rejection into emptyData(), so a broken
 * query and a genuinely empty project rendered identically.
 */

import type { Instant } from "../shared/instant";
import type { FunnelResult } from "../analytics/funnel";
import type { RetentionGrid } from "../analytics/retention";
import type { Trend } from "../analytics/trend";
import type { TileId } from "./tile";

export type SeriesPoint = { readonly bucketStart: Instant; readonly value: number };

export type ReadoutValue =
  | { readonly shape: "scalar"; readonly value: number; readonly trend?: Trend }
  | { readonly shape: "series"; readonly points: readonly SeriesPoint[]; readonly trend?: Trend }
  | { readonly shape: "breakdown"; readonly rows: readonly { label: string; value: number }[] }
  | { readonly shape: "funnel"; readonly result: FunnelResult }
  | { readonly shape: "retention"; readonly grid: RetentionGrid };

export type ReadoutFailure = {
  readonly code: "timeout" | "unsupported" | "store_unavailable" | "invalid_request";
  readonly detail: string;
  readonly retriable: boolean;
};

/** Either an answer or a stated reason there is none. Never a silent blank. */
export type Readout =
  | { readonly tile: TileId; readonly ok: true; readonly value: ReadoutValue; readonly computedAt: Instant }
  | { readonly tile: TileId; readonly ok: false; readonly failure: ReadoutFailure };

export const Readout = {
  answered: (tile: TileId, value: ReadoutValue, computedAt: Instant): Readout => ({
    tile,
    ok: true,
    value,
    computedAt,
  }),
  failed: (tile: TileId, failure: ReadoutFailure): Readout => ({ tile, ok: false, failure }),
} as const;
