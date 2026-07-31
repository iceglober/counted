/**
 * AnalyticalStore — the port through which questions become numbers.
 *
 * Two design choices carry most of the weight.
 *
 * **`executeBatch`, not `execute`.** A dashboard asks many questions at once.
 * v1's loader fired them one at a time and a realistic dashboard cost ~24
 * round trips against a pool of 20, five of them strictly serial inside the
 * funnel. Handing the whole batch over lets an adapter coalesce identical
 * requests (`Analysis.toKey` exists for exactly this), run one statement per
 * distinct question, and answer from one consistent snapshot.
 *
 * **`Outcome` has no zero value.** There is no "empty result" a failure can
 * quietly become. v1 wrapped its fan-out in `Promise.allSettled` and mapped
 * every rejection to `emptyData()`, so a broken query and an empty project
 * rendered identically and nobody could tell from the screen which they were
 * looking at. Here a caller must destructure `ok` before reaching a value, and
 * `emptyData()` is simply not expressible at this layer.
 *
 * The store returns **raw counts**. Conversion rates, cohort grids, zero-fill
 * and trends are computed in the domain, which is what keeps that arithmetic
 * testable without a database.
 */

import type {
  Analysis,
  CohortSize,
  Funnel,
  Instant,
  ProjectId,
  Retention,
  RetentionObservation,
  TimeAxis,
} from "@counted/domain";
import type { Brand } from "@counted/domain";

export type RequestId = Brand<string, "RequestId">;
export const RequestId = (raw: string): RequestId => raw as RequestId;

/**
 * The five question shapes. Anything a tile or a monitor can ask reduces to
 * one of these, which is what keeps the compiler surface finite.
 */
/**
 * The absolute interval a request covers.
 *
 * Relative windows ("last 7 days") are resolved **once**, in the application,
 * against the Clock port — never by the store. An adapter that read its own
 * clock would be ambient time inside the hexagon, and two requests in the same
 * batch could silently cover different intervals.
 */
export type ResolvedBounds = { readonly from: Instant; readonly to: Instant };

export type StoreRequest =
  | {
      readonly id: RequestId;
      readonly kind: "scalar";
      readonly project: ProjectId;
      readonly analysis: Analysis;
      readonly bounds: ResolvedBounds;
    }
  | {
      readonly id: RequestId;
      readonly kind: "series";
      readonly project: ProjectId;
      readonly analysis: Analysis;
      /** Bucket edges computed by the domain. The store assigns, it does not bucket. */
      readonly axis: TimeAxis;
      readonly bounds: ResolvedBounds;
    }
  | {
      readonly id: RequestId;
      readonly kind: "breakdown";
      readonly project: ProjectId;
      readonly analysis: Analysis;
      readonly bounds: ResolvedBounds;
    }
  | {
      readonly id: RequestId;
      readonly kind: "sequence";
      readonly project: ProjectId;
      readonly funnel: Funnel;
      readonly bounds: ResolvedBounds;
    }
  | {
      readonly id: RequestId;
      readonly kind: "cohorts";
      readonly project: ProjectId;
      readonly retention: Retention;
      readonly bounds: ResolvedBounds;
    };

export type BreakdownRow = { readonly label: string; readonly value: number };

export type StoreResult =
  | { readonly kind: "scalar"; readonly value: number }
  /** Dense and aligned to the requested axis: one entry per bucket, in order. */
  | { readonly kind: "series"; readonly values: readonly number[] }
  | { readonly kind: "breakdown"; readonly rows: readonly BreakdownRow[] }
  /** One count per funnel step, in step order. The domain derives the rates. */
  | { readonly kind: "sequence"; readonly counts: readonly number[] }
  | {
      readonly kind: "cohorts";
      readonly sizes: readonly CohortSize[];
      readonly observations: readonly RetentionObservation[];
    };

export type StoreError =
  | { readonly code: "timeout"; readonly budgetMs: number; readonly retriable: true }
  | { readonly code: "store_unavailable"; readonly detail: string; readonly retriable: true }
  | { readonly code: "unsupported"; readonly detail: string; readonly retriable: false }
  | { readonly code: "invalid_request"; readonly detail: string; readonly retriable: false };

/**
 * An answer or a stated reason there is none. Deliberately has no third,
 * "nothing here" case — see the note at the top of this file.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T; readonly from: "store" | "cache"; readonly computedAt: Instant }
  | { readonly ok: false; readonly error: StoreError };

export type BatchStats = {
  readonly statements: number;
  readonly totalMs: number;
  /** How many requests were answered by coalescing onto another. */
  readonly coalesced: number;
};

export type BatchOutcome = {
  /** One entry per request id. Never partial, never silently short. */
  readonly results: ReadonlyMap<RequestId, Outcome<StoreResult>>;
  readonly stats: BatchStats;
};

export type ExecOptions = {
  /** Hard ceiling for the whole batch. An adapter must honour it. */
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
  readonly traceId: string;
};

/**
 * What a particular store can do. Probed at boot rather than assumed, so a
 * missing extension is a logged fact instead of a query that throws on first
 * use. v1's migration silently failed on plain Postgres every boot and every
 * timeseries query then threw `function time_bucket does not exist`, surfacing
 * to users as empty charts.
 */
export type StoreCapabilities = {
  readonly engine: string;
  /** Approximate distinct counts available (e.g. postgresql-hll). */
  readonly approximateDistinct: boolean;
  readonly partitioning: "declarative" | "hypertable" | "none";
};

export interface AnalyticalStore {
  executeBatch(requests: readonly StoreRequest[], options: ExecOptions): Promise<BatchOutcome>;
  capabilities(): StoreCapabilities;
}
