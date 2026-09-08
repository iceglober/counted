/**
 * AnalyticsEngine — the port through which questions become numbers.
 *
 * Three things carry most of the weight here.
 *
 * **The vocabulary is ours, not the engine's.** Under v3 the implementation is
 * `@litics/core` over the `pg` pool, and litics has opinions: reads answer
 * from per-segment summaries and decoded segments, filters are flat dimension
 * equality over declared columns, and bucket edges are anchored on the hour.
 * Those constraints are real and this interface reflects them honestly — but
 * it states them in Counted's types, so replacing the engine is a new adapter
 * and not a new domain.
 *
 * **An outcome has no zero value.** There is no "empty result" a failure can
 * quietly become. v1 wrapped its fan-out in `Promise.allSettled` and mapped
 * every rejection to `emptyData()`, so a broken query and an empty project
 * rendered identically and nobody could tell from the screen which they were
 * looking at. Here a caller must read `ok` before reaching a value.
 *
 * **What is missing is missing on purpose.** litics ships `counts`, `uniques`,
 * `sums`, `funnel` and — since the group-by work — a real breakdown. It still
 * has no cohort retention and no nested predicates. Those gaps are declared
 * below as typed `not_implemented` outcomes rather than faked, because a chart
 * that is empty by construction is worse than a feature that says it is not
 * here yet. Cohort retention requires engine support that is not implemented.
 */

import type { Predicate } from "@counted/analytics-domain";
import type {
  Duration,
  Instant,
  ProjectId,
  WorkspaceId,
} from "@counted/kernel";

/**
 * Which slice of the tenancy tree to read.
 *
 * A workspace scope aggregates its whole subtree, and that is free rather than
 * expensive: counts and sums are additive and actor sketches (KMV) merge
 * without double counting, so workspace-level uniques come out of
 * project-level summaries. "Unique visitors across a workspace" — Counted's
 * hardest analytics question — is answered by the data structure, not by a
 * query.
 */
export type EngineScope =
  | { readonly level: "workspace"; readonly workspace: WorkspaceId }
  | { readonly level: "project"; readonly project: ProjectId };

/**
 * The absolute interval a query covers.
 *
 * Relative windows ("last 7 days") are resolved **once**, in the application,
 * against the Clock port — never by the engine. An engine that read its own
 * clock would be ambient time inside the hexagon, and two queries issued
 * together could silently cover different intervals.
 */
export type Bounds = { readonly from: Instant; readonly to: Instant };

/** Bucket width. The engine owns the edges; this names the width it uses. */
export type Step = "hour" | "day" | "week" | "month";

/**
 * Dimension filters: exact match, one value per dimension.
 *
 * This is the honest boundary, not a simplification for later. Per-segment
 * summaries are what make reads fast at any history depth, and they answer
 * filters over the declared dimensions only. Every predicate the product
 * promises beyond this shape is a decode of every segment and gives that up —
 * so it is a product decision, taken deliberately, rather than an engine
 * feature request. Anything richer comes back as `not_implemented`.
 */
export type Filters = Readonly<Record<string, string>>;

export type SeriesQuery = {
  readonly scope: EngineScope;
  readonly bounds: Bounds;
  readonly step: Step;
  /** One optional property split, kept consistent across all time buckets. */
  readonly by?: string;
  /** Merge actor sets over the entire period for a unique total. */
  readonly wholeWindow?: boolean;
  /** Restrict to one event type or their union. Omit for all; an empty set matches nothing. */
  readonly event?: string | readonly string[];
  readonly filters?: Filters;
  /** Full predicate for bounded scans when indexed equality is insufficient. */
  readonly predicate?: Predicate;
};

/** `start` is the bucket's left edge; buckets are contiguous and in order. */
export type Bucket = { readonly start: Instant; readonly value: number };

/**
 * Dense and aligned to the requested step: one bucket per interval, including
 * the ones that are zero. A sparse series is how a chart ends up with a gap
 * where it should have a floor.
 */
export type Series = {
  readonly buckets: readonly Bucket[];
  readonly groups?: readonly {
    readonly key: string | null;
    readonly buckets: readonly Bucket[];
  }[];
};

export type SumsQuery = SeriesQuery & {
  /** The measure to sum, by name, as declared in the litics config. */
  readonly measure: string;
};

export type SortDirection = "asc" | "desc";

/**
 * A breakdown: one number per value of one dimension, over the whole window.
 *
 * This used to be `limit` separate queries — one per value, with the values
 * themselves fetched first from `SchemaCatalog.dimensionValues`. It is one
 * query now, because litics groups over the declared dimension columns;
 * `limit` has stopped being a fan-out bound and is what it reads like, the
 * number of rows a caller wants back.
 *
 * Two things about the shape.
 *
 * **`step` names the grid, not the buckets.** A breakdown has no buckets: the
 * value in each row covers the whole window in one bin. The step still decides
 * where the window starts (its left edge is floored onto that grid, exactly as
 * a series' is).
 *
 * **One bin is what makes a unique breakdown correct.** Summing per-bucket
 * cardinalities over-counts anyone who came back on a second day. The actor
 * sets are merged across the whole window inside one read instead, so
 * "unique visitors by country, last 30 days" is one merge per country and not
 * a sum of thirty of them.
 */
export type BreakdownQuery = Omit<SeriesQuery, "by" | "wholeWindow"> & {
  /** The dimension to split by. Must be a declared dimension. */
  readonly by: string | readonly string[];
  /** Which end of the ranking `limit` keeps. */
  readonly order: SortDirection;
  /** How many rows to return, ranked by value. */
  readonly limit: number;
};

export type SumsBreakdownQuery = BreakdownQuery & {
  readonly measure: string;
};

/**
 * One row of a breakdown.
 *
 * `key` is `null` when the events carried no value for that dimension — a
 * real group with a real number in it, not a missing row. litics rolls those
 * up under a sentinel that is deliberately not a dictionary entry, so they
 * can be told apart from a value that happens to be the empty string.
 * A caller that drops them gets a chart whose bars do not add up to its total.
 */
export type BreakdownEntry = {
  readonly key: string | null;
  readonly keys?: readonly (string | null)[];
  readonly value: number;
};

/** Ranked by value in the requested direction, and no longer than `limit`. */
export type Breakdown = { readonly rows: readonly BreakdownEntry[] };

/**
 * Exactly three steps, in order.
 *
 * Not a limitation we chose — litics' funnel builder takes a 3-tuple. Stated
 * in the type so a caller finds out at compile time rather than by getting a
 * runtime error from a generated statement.
 */
export type FunnelSteps = readonly [string, string, string];

export type FunnelQuery = {
  readonly scope: EngineScope;
  readonly bounds: Bounds;
  readonly steps: FunnelSteps;
  /** Max time from step one to completion. Defaults to seven days. */
  readonly within?: Duration;
};

/** One count per step, in step order. The domain derives the rates. */
export type FunnelCounts = {
  readonly counts: readonly [number, number, number];
};

export type RetentionQuery = {
  readonly scope: EngineScope;
  readonly bounds: Bounds;
  /** Cohort width — daily, weekly or monthly cohorts. */
  readonly cohortStep: Step;
  readonly periods: number;
};

/**
 * Capabilities a caller may be told are absent.
 *
 * `retention` is the live one. `group_by` is no longer produced by anything —
 * breakdowns are a real group-by since litics grew one — and `nested_predicates`
 * never was; both stay in the union because they are the wire vocabulary of
 * `NotImplemented` and dropping a value from a published enum is a contract
 * change, not a cleanup. Nothing may start returning `group_by` again.
 */
export type MissingFeature = "retention" | "group_by" | "nested_predicates";

export type EngineFailure =
  | { readonly kind: "Timeout"; readonly budget: Duration }
  | { readonly kind: "Unavailable"; readonly detail: string }
  | { readonly kind: "InvalidQuery"; readonly detail: string }
  | { readonly kind: "NotImplemented"; readonly feature: MissingFeature };

export type EngineOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly computedAt: Instant }
  | { readonly ok: false; readonly error: EngineFailure };

/**
 * An outcome that can only fail, for a capability that does not exist yet.
 *
 * Typed this way rather than as a plain `EngineOutcome` on purpose: the
 * compiler tells every caller that there is no success branch to write, so the
 * absence shows up in the console as "not available yet" rather than as an
 * empty grid nobody can distinguish from "no data".
 */
export type NotImplemented<F extends MissingFeature> = {
  readonly ok: false;
  readonly error: { readonly kind: "NotImplemented"; readonly feature: F };
};

export type QueryOptions = {
  /** Hard ceiling. An adapter must honour it and return `Timeout`, not hang. */
  readonly deadline: Duration;
  readonly signal?: AbortSignal;
  readonly traceId: string;
};

export interface AnalyticsEngine {
  /** Event counts per bucket. */
  counts(
    query: SeriesQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Series>>;

  /**
   * Unique actors per bucket. Exact while a bucket holds fewer than a few
   * thousand actors; beyond that a KMV estimate within a few percent.
   * Approximate is stated here because it is a property of the answer, and a
   * caller that renders it as an exact number is making a claim the data does
   * not support.
   */
  uniques(
    query: SeriesQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Series>>;

  /** Per-bucket sum of one measure. */
  sums(query: SumsQuery, options: QueryOptions): Promise<EngineOutcome<Series>>;

  /** Event counts per value of one dimension, over the whole window. */
  countsBy(
    query: BreakdownQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Breakdown>>;

  /**
   * Unique actors per value of one dimension, over the whole window — one
   * merged actor set per value, not a sum of per-bucket cardinalities.
   */
  uniquesBy(
    query: BreakdownQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Breakdown>>;

  /** Sum of one measure per value of one dimension, over the whole window. */
  sumsBy(
    query: SumsBreakdownQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Breakdown>>;

  /** Actors who did step one, then two, then three, in order, within `within`. */
  funnel(
    query: FunnelQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<FunnelCounts>>;

  /**
   * Cohort retention. **Not implemented, and the signature says so.**
   *
   * Calendar-based cohort retention requires a customer-supplied `PersonId`.
   * litics has nothing that computes one. Return an explicit unsupported result
   * rather than a grid that is empty by construction.
   *
   * When litics grows it, widen the return type to
   * `Promise<EngineOutcome<RetentionGrid>>`; every caller then fails to compile
   * until it handles the success case, which is the point.
   */
  retention(
    query: RetentionQuery,
    options: QueryOptions,
  ): Promise<NotImplemented<"retention">>;
}
