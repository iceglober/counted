/**
 * `AnalyticsEngine` over `@litics/core`'s read engine.
 *
 * The adapter is three steps, and keeping them apart is what makes the
 * interesting parts testable without a database: `plan.ts` decides what to
 * ask and what to refuse, litics' engine answers each read from summaries,
 * segments and the staging tail in one snapshot, and this file turns rows
 * back into the port's types. Only the middle needs Postgres, and a test
 * supplies a fake reader for it.
 *
 * Two properties this file is responsible for.
 *
 * **A failure never becomes a number.** v1 wrapped its dashboard fan-out in
 * `Promise.allSettled` and mapped every rejection to `emptyData()`, so a broken
 * query and a quiet project drew the same chart. Every path here returns an
 * outcome the caller has to open before it reaches a value, and the one place
 * that could still fake it — a row whose aggregate did not parse as a number —
 * refuses instead of substituting zero.
 *
 * **A series is dense.** The engine returns only the buckets that have rows;
 * the missing ones are the zeroes, and a chart drawn from the sparse form has a
 * gap where it should have a floor. `densify` fills them against the same grid
 * the read's binning origin came from.
 */

import {
  createEngine,
  type Engine as SegmentReader,
  type EngineOptions,
  type QueryOptions as ReadOptions,
  type RangeQuery,
  type RangeRow,
  type ReadStats,
} from "@litics/core";
import type {
  AnalyticsEngine,
  Breakdown,
  BreakdownEntry,
  BreakdownQuery,
  Bucket,
  EngineFailure,
  EngineOutcome,
  FunnelCounts,
  FunnelQuery,
  NotImplemented,
  QueryOptions,
  RetentionQuery,
  Series,
  SeriesQuery,
  SumsBreakdownQuery,
  SumsQuery,
} from "@counted/analytics-ports";
import { Instant } from "@counted/kernel";
import type { Clock } from "@counted/kernel/ports";

import { RawPropertyReader, rawFunnel, rawSeries, rawBreakdown, needsRaw } from "./raw";
import { densify } from "./bucketing";
import { openBudget, type Budget } from "./budget";
import { resolved, STREAM } from "./config";
import { numberAt, timestampAt, type Row } from "./execute";
import { failureFor } from "./failures";
import {
  planBreakdown,
  planFunnel,
  planSeries,
  planSums,
  type BreakdownPlan,
  type SeriesPlan,
} from "./plan";

/** The pool shape litics' engine borrows connections from. A real `pg.Pool` is one. */
export type EnginePool = EngineOptions["pool"];

export type { SegmentReader };

/** Decoded segments cached per process, by default. Overridden per app from its config. */
export const DEFAULT_CACHE_BYTES = 256 * 1024 * 1024;

export type LiticsEngineDeps = {
  readonly pool: EnginePool;
  /**
   * Read once per call, for `computedAt` and for the retention checks.
   *
   * The engine needs a clock and the domain must not have one — so it arrives
   * here, at the edge, as the port `@counted/kernel/ports` declares. Note what
   * it is NOT used for: resolving a relative window. That happens once per
   * dashboard load in the application, because two tiles resolved against two
   * different `now`s would silently cover different intervals.
   */
  readonly clock: Clock;
  /** Byte budget for decoded segments kept in memory. */
  readonly cacheBytes?: number;
  /** Called after every read with what it touched; the app logs it. */
  readonly onRead?: (stats: ReadStats) => void;
  /** A test seam: the litics reader to use instead of one built over `pool`. */
  readonly reader?: SegmentReader;
  readonly rawReader?: Pick<RawPropertyReader, "read">;
};

/** How a row's aggregate is named, per read. */
const COUNT_COLUMN = "n";
const UNIQUE_COLUMN = "actors";
const SUM_COLUMN = "sum";

type Read = (query: RangeQuery, options: ReadOptions) => Promise<RangeRow[]>;

const failed = <T>(error: EngineFailure): EngineOutcome<T> => ({
  ok: false,
  error,
});

const malformed = (column: string): EngineFailure => ({
  kind: "Unavailable",
  detail: `the engine returned a row whose "${column}" was not a number`,
});

const timedOut = (options: QueryOptions): EngineFailure => ({
  kind: "Timeout",
  budget: options.deadline,
});

export class LiticsAnalyticsEngine implements AnalyticsEngine {
  readonly #reader: SegmentReader;
  readonly #projectReader: SegmentReader;
  readonly #clock: Clock;
  readonly #raw: Pick<RawPropertyReader, "read">;

  constructor(deps: LiticsEngineDeps) {
    this.#clock = deps.clock;
    this.#raw = deps.rawReader ?? new RawPropertyReader(deps.pool);
    this.#reader =
      deps.reader ??
      createEngine(resolved, {
        pool: deps.pool,
        cache: { maxBytes: deps.cacheBytes ?? DEFAULT_CACHE_BYTES },
        ...(deps.onRead === undefined
          ? {}
          : { onRead: (_stream, stats) => deps.onRead?.(stats) }),
      });
    // A project is an exact tenant, including before it joins a workspace tree.
    // Reuse the decoded-segment cache; the data/config are otherwise identical.
    this.#projectReader = deps.reader ?? createEngine({...resolved, tenancy: {type: "text", hierarchy: null}}, {
      pool: deps.pool, cache: this.#reader.cache,
      ...(deps.onRead === undefined ? {} : {onRead: (_stream,stats) => deps.onRead?.(stats)}),
    });
  }

  #readerFor(scope: SeriesQuery["scope"]): SegmentReader {
    return scope.level === "project" ? this.#projectReader : this.#reader;
  }

  async counts(
    query: SeriesQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Series>> {
    if (needsRaw(query)) {
      const {by: _by, predicate: _predicate, ...indexed} = query;
      const valid = planSeries(indexed, this.#clock.now(), {additive: true});
      if (!valid.ok) return failed(valid.error);
      try { return { ok: true, value: rawSeries(await this.#raw.read(query.scope, query.bounds, options), query, false), computedAt: this.#clock.now() }; }
      catch (cause) { return failed(failureFor(cause, options.deadline)); }
    }
    const plan = planSeries(query, this.#clock.now(), { additive: true });
    if (!plan.ok) return failed(plan.error);
    return await this.#runSeries(
      plan.plan,
      COUNT_COLUMN,
      (q, o) => this.#readerFor(query.scope).counts(STREAM, q, o),
      options,
    );
  }

  /**
   * Unique actors — which, on this deployment, means unique **visits**.
   *
   * litics has one `actor_id` per stream and it is `NOT NULL`; most Counted
   * events carry no `PersonId`, so the visit is the only identifier every event
   * can supply. `config.ts` states this at length. The number is exact while a
   * bucket holds fewer than a few thousand visits and a KMV estimate (within
   * a few percent) beyond that.
   */
  async uniques(
    query: SeriesQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Series>> {
    if (needsRaw(query)) {
      const {by: _by, predicate: _predicate, ...indexed} = query;
      const valid = planSeries(indexed, this.#clock.now(), {additive: true});
      if (!valid.ok) return failed(valid.error);
      try { return { ok: true, value: rawSeries(await this.#raw.read(query.scope, query.bounds, options), query, true), computedAt: this.#clock.now() }; }
      catch (cause) { return failed(failureFor(cause, options.deadline)); }
    }
    // Not additive: actor sets merge inside one read, never across two, so a
    // monthly series is one read per calendar month.
    const plan = planSeries(query, this.#clock.now(), { additive: false });
    if (!plan.ok) return failed(plan.error);
    return await this.#runSeries(
      plan.plan,
      UNIQUE_COLUMN,
      (q, o) => this.#readerFor(query.scope).uniques(STREAM, q, o),
      options,
    );
  }

  async sums(
    query: SumsQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Series>> {
    const plan = planSums(query, this.#clock.now());
    if (!plan.ok) return failed(plan.error);
    return await this.#runSeries(
      plan.plan,
      SUM_COLUMN,
      (q, o) => this.#readerFor(query.scope).sums(STREAM, query.measure, q, o),
      options,
    );
  }

  async countsBy(
    query: BreakdownQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Breakdown>> {
    if (needsRaw(query)) {
      const {by: _by, predicate: _predicate, ...indexed} = query;
      const fields = typeof query.by === "string" ? [query.by] : query.by;
      if (fields.length < 1 || fields.length > 3 || new Set(fields).size !== fields.length)
        return failed({kind: "InvalidQuery", detail: "A breakdown needs one to three different properties."});
      const valid = planBreakdown({...indexed, by: "event_type"}, this.#clock.now());
      if (!valid.ok) return failed(valid.error);
      try { return { ok: true, value: rawBreakdown(await this.#raw.read(query.scope, query.bounds, options), query, false), computedAt: this.#clock.now() }; }
      catch (cause) { return failed(failureFor(cause, options.deadline)); }
    }
    const plan = planBreakdown(query, this.#clock.now());
    if (!plan.ok) return failed(plan.error);
    return await this.#runBreakdown(
      plan.plan,
      COUNT_COLUMN,
      (q, o) => this.#readerFor(query.scope).counts(STREAM, q, o),
      options,
    );
  }

  /**
   * Unique actors per dimension value — one merged actor set over the whole
   * window per value.
   *
   * The window is a single bin (see `wholeWindowStride`), which is the whole
   * point: adding up per-bucket cardinalities counts anyone who came back on a
   * second day twice, and no amount of care in this file could undo it
   * afterwards.
   */
  async uniquesBy(
    query: BreakdownQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Breakdown>> {
    if (needsRaw(query)) {
      const {by: _by, predicate: _predicate, ...indexed} = query;
      const fields = typeof query.by === "string" ? [query.by] : query.by;
      if (fields.length < 1 || fields.length > 3 || new Set(fields).size !== fields.length)
        return failed({kind: "InvalidQuery", detail: "A breakdown needs one to three different properties."});
      const valid = planBreakdown({...indexed, by: "event_type"}, this.#clock.now());
      if (!valid.ok) return failed(valid.error);
      try { return { ok: true, value: rawBreakdown(await this.#raw.read(query.scope, query.bounds, options), query, true), computedAt: this.#clock.now() }; }
      catch (cause) { return failed(failureFor(cause, options.deadline)); }
    }
    const plan = planBreakdown(query, this.#clock.now());
    if (!plan.ok) return failed(plan.error);
    return await this.#runBreakdown(
      plan.plan,
      UNIQUE_COLUMN,
      (q, o) => this.#readerFor(query.scope).uniques(STREAM, q, o),
      options,
    );
  }

  async sumsBy(
    query: SumsBreakdownQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<Breakdown>> {
    const plan = planBreakdown(query, this.#clock.now(), {
      measure: query.measure,
    });
    if (!plan.ok) return failed(plan.error);
    return await this.#runBreakdown(
      plan.plan,
      SUM_COLUMN,
      (q, o) => this.#readerFor(query.scope).sums(STREAM, query.measure, q, o),
      options,
    );
  }

  async funnel(
    query: FunnelQuery,
    options: QueryOptions,
  ): Promise<EngineOutcome<FunnelCounts>> {
    const plan = planFunnel(query, this.#clock.now());
    if (!plan.ok) return failed(plan.error);

    try {
      // The raw reader uses one repeatable-read snapshot for packed rows and
      // the tail. Evaluating named steps directly handles absent dictionary
      // entries and repeated step names without losing completed early steps.
      const events = await this.#raw.read(query.scope, query.bounds, options);
      return {ok: true, value: rawFunnel(events, query), computedAt: this.#clock.now()};
    } catch (cause) { return failed(failureFor(cause, options.deadline)); }
  }

  /**
   * Cohort retention. Not implemented, and the type says so.
   *
   * litics has nothing that computes a cohort grid. Returning an empty
   * grid would be the failure this package exists to prevent: a chart that is
   * empty by construction is indistinguishable from a project with no
   * retention. When litics grows it, widen the port's return type and every
   * caller stops compiling until it handles the success case.
   */
  async retention(
    _query: RetentionQuery,
    _options: QueryOptions,
  ): Promise<NotImplemented<"retention">> {
    return {
      ok: false,
      error: { kind: "NotImplemented", feature: "retention" },
    };
  }

  async #runSeries(
    plan: SeriesPlan,
    column: string,
    read: Read,
    options: QueryOptions,
  ): Promise<EngineOutcome<Series>> {
    if (plan.calls.length === 0) {
      return {
        ok: true,
        value: { buckets: [] },
        computedAt: this.#clock.now(),
      };
    }
    const budget = openBudget(options);
    const rows: { at: Instant; value: number }[] = [];
    const groups = new Map<string | null, { at: Instant; value: number }[]>();
    for (const call of plan.calls) {
      // One budget across the month loop: the twelfth read gets what the
      // first eleven left, not a fresh deadline of its own.
      if (budget.expired()) return failed(timedOut(options));
      let result: RangeRow[];
      try {
        result = await read(call.query, readOptions(budget));
      } catch (cause) {
        return failed(failureFor(cause, options.deadline));
      }
      for (const row of result) {
        const parsed = readBucket(row, column);
        if (parsed === null) return failed(malformed(column));
        if (plan.by === undefined) rows.push(parsed);
        else {
          const key = keyAt(row, plan.by);
          if (!key) return failed(malformed(plan.by));
          const items = groups.get(key.key) ?? [];
          items.push(parsed);
          groups.set(key.key, items);
        }
      }
    }
    if (plan.by !== undefined)
      return {
        ok: true,
        value: {
          buckets: [],
          groups: [...groups].map(([key, items]) => ({
            key,
            buckets: densify(plan.starts, plan.step, items),
          })),
        },
        computedAt: this.#clock.now(),
      };
    const buckets: readonly Bucket[] = densify(plan.starts, plan.step, rows);
    return { ok: true, value: { buckets }, computedAt: this.#clock.now() };
  }

  async #runBreakdown(
    plan: BreakdownPlan,
    column: string,
    read: Read,
    options: QueryOptions,
  ): Promise<EngineOutcome<Breakdown>> {
    const budget = openBudget(options);
    let result: RangeRow[];
    try {
      result = await read(plan.call.query, readOptions(budget));
    } catch (cause) {
      return failed(failureFor(cause, options.deadline));
    }

    const rows: BreakdownEntry[] = [];
    const seen = new Set<string>();
    for (const row of result) {
      const keys: (string | null)[] = [];
      for (const field of plan.by) {
        const key = keyAt(row, field);
        if (key === null)
          return failed({
            kind: "Unavailable",
            detail: `the engine returned a row whose "${field}" was not a dimension value`,
          });
        keys.push(key.key);
      }
      const value = numberAt(row, column);
      if (value === null) return failed(malformed(column));
      const tuple = JSON.stringify(keys);
      if (seen.has(tuple))
        return failed({
          kind: "Unavailable",
          detail: `the engine returned more than one bucket for ${plan.by.join(", ")} = ${tuple}`,
        });
      seen.add(tuple);
      rows.push(
        keys.length === 1
          ? { key: keys[0]!, value }
          : { key: tuple, keys, value },
      );
    }

    return {
      ok: true,
      value: { rows: rank(rows, plan.order, plan.limit) },
      computedAt: this.#clock.now(),
    };
  }
}

const readOptions = (budget: Budget): ReadOptions => ({
  ...(budget.signal === undefined ? {} : { signal: budget.signal }),
  statementTimeoutMs: budget.statementTimeoutMs(),
});

/**
 * Rank and cut a breakdown here rather than in the engine.
 *
 * litics' `groupBy` has no ordering or limit of its own, and giving it one
 * would be a footgun in the library: with more than one bucket, "the top ten
 * rows" is ten (bucket, value) pairs and not the ten biggest values of
 * anything. A breakdown is one bucket by construction, so the ranking is
 * unambiguous exactly here and nowhere else.
 *
 * Ties break on the key so two identical questions return identical rows; a
 * chart whose bars swap places between refreshes reads as data changing.
 */
const rank = (
  rows: readonly BreakdownEntry[],
  order: "asc" | "desc",
  limit: number,
): readonly BreakdownEntry[] =>
  [...rows]
    .sort((a, b) =>
      a.value === b.value
        ? (a.key ?? "").localeCompare(b.key ?? "")
        : order === "desc"
          ? b.value - a.value
          : a.value - b.value,
    )
    .slice(0, limit);

/**
 * The grouped column: a decoded dimension value, or `null` for the events that
 * carried none. Anything else means the row is not the row we asked for.
 */
const keyAt = (row: Row, column: string): { key: string | null } | null => {
  if (!Object.hasOwn(row, column)) return null;
  const value = row[column];
  if (value === null || value === undefined) return { key: null };
  if (typeof value === "string") return { key: value };
  return null;
};

const readBucket = (
  row: Row,
  column: string,
): { at: Instant; value: number } | null => {
  const at = timestampAt(row, "bucket");
  const value = numberAt(row, column);
  if (at === null || value === null) return null;
  return { at: Instant.fromDate(at), value };
};
