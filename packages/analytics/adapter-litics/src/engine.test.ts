import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import type {
  FunnelResult,
  RangeQuery,
  RangeRow,
  ReadPlan,
  SegmentCache,
} from "@litics/core";
import { AbortError } from "@litics/core";
import { Duration, Instant, ProjectId } from "@counted/kernel";
import { fixedClock } from "@counted/kernel/ports";
import type {
  BreakdownQuery,
  EngineScope,
  QueryOptions,
  SeriesQuery,
} from "@counted/analytics-ports";

import {
  LiticsAnalyticsEngine,
  type EnginePool,
  type SegmentReader,
} from "./engine";

/**
 * A real `pg.Pool` has to keep fitting the pool shape litics' engine takes.
 * Nothing else checks it, and the day it stops fitting is the day the
 * composition root stops compiling for a reason that reads like litics'.
 */
const _poolFits: (pool: Pool) => EnginePool = (pool) => pool;

const at = (iso: string): Instant => {
  const parsed = Instant.fromISO(iso);
  if (!parsed.ok) throw new Error(`bad fixture instant: ${iso}`);
  return parsed.value;
};

const NOW = at("2024-06-01T00:00:00Z");
const CLOCK = fixedClock(NOW);
const PROJECT: EngineScope = { level: "project", project: ProjectId("prj_1") };
const OPTIONS: QueryOptions = {
  deadline: Duration.seconds(10),
  traceId: "test",
};

const series = (over: Partial<SeriesQuery> = {}): SeriesQuery => ({
  scope: PROJECT,
  bounds: { from: at("2024-05-01T00:00:00Z"), to: at("2024-05-04T00:00:00Z") },
  step: "day",
  ...over,
});

type Call = {
  kind: "counts" | "uniques" | "sums" | "funnel";
  query: RangeQuery | object;
  statementTimeoutMs: number | undefined;
  signal: AbortSignal | undefined;
};
type Respond = (kind: Call["kind"], query: RangeQuery) => RangeRow[] | Error;

/**
 * A fake litics reader: the seam the engine exposes for exactly this. It
 * records every read and answers with whatever rows the test hands it.
 */
const fakeReader = (
  respond: Respond,
  funnel: FunnelResult | Error = { step1: 0, step2: 0, step3: 0 },
) => {
  const calls: Call[] = [];
  const answer =
    (kind: Call["kind"]) =>
    async (
      _stream: string,
      query: RangeQuery,
      opts?: { signal?: AbortSignal; statementTimeoutMs?: number },
    ) => {
      calls.push({
        kind,
        query,
        statementTimeoutMs: opts?.statementTimeoutMs,
        signal: opts?.signal,
      });
      if (opts?.signal?.aborted) throw new AbortError();
      const rows = respond(kind, query);
      if (rows instanceof Error) throw rows;
      return rows;
    };
  const reader: SegmentReader = {
    counts: answer("counts"),
    uniques: answer("uniques"),
    sums: (stream, _measure, query, opts) =>
      answer("sums")(stream, query, opts),
    async funnel(_stream, steps, query, opts) {
      calls.push({
        kind: "funnel",
        query: { steps, ...query },
        statementTimeoutMs: opts?.statementTimeoutMs,
        signal: opts?.signal,
      });
      if (funnel instanceof Error) throw funnel;
      return funnel;
    },
    explainRead: () => ({ path: "summary" }) as ReadPlan,
    cache: { clear() {} } as unknown as SegmentCache,
  };
  return { reader, calls };
};

const pool = {
  connect: async () => {
    throw new Error("the fake reader never touches the pool");
  },
} as unknown as EnginePool;
const engineWith = (reader: SegmentReader): LiticsAnalyticsEngine =>
  new LiticsAnalyticsEngine({ pool, clock: CLOCK, reader });

const codedError = (code: string): Error =>
  Object.assign(new Error(`pg said ${code}`), { code });

describe("counts", () => {
  test("fills the buckets the engine did not return, so a quiet day is a floor and not a gap", async () => {
    const { reader } = fakeReader(() => [
      { bucket: new Date("2024-05-02T00:00:00Z"), n: 12 },
    ]);
    const outcome = await engineWith(reader).counts(series(), OPTIONS);
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.buckets.map((b) => b.value)).toEqual([0, 12, 0]);
    expect(outcome.value.buckets.map((b) => Instant.toISO(b.start))).toEqual([
      "2024-05-01T00:00:00.000Z",
      "2024-05-02T00:00:00.000Z",
      "2024-05-03T00:00:00.000Z",
    ]);
    expect(Instant.toISO(outcome.computedAt)).toBe("2024-06-01T00:00:00.000Z");
  });

  test("a broken read is a failure, never an empty series", async () => {
    // v1 wrapped its dashboard fan-out in Promise.allSettled and mapped every
    // rejection to emptyData(), so a broken query and a quiet project drew the
    // same chart and nobody could tell which they were looking at.
    const { reader } = fakeReader(() => codedError("42P01"));
    const outcome = await engineWith(reader).counts(series(), OPTIONS);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.kind).toBe("Unavailable");
    if (outcome.error.kind !== "Unavailable") return;
    expect(outcome.error.detail).toContain("migrations");
  });

  test("a statement timeout comes back as Timeout carrying the budget the caller set", async () => {
    const { reader } = fakeReader(() => codedError("57014"));
    const outcome = await engineWith(reader).counts(series(), OPTIONS);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.kind).toBe("Timeout");
    if (outcome.error.kind !== "Timeout") return;
    expect(Duration.toMillis(outcome.error.budget)).toBe(10_000);
  });

  test("an aggregate that is not a number refuses rather than counting as zero", async () => {
    const { reader } = fakeReader(() => [
      {
        bucket: new Date("2024-05-02T00:00:00Z"),
        n: null as unknown as number,
      },
    ]);
    expect((await engineWith(reader).counts(series(), OPTIONS)).ok).toBe(false);
  });

  test("the deadline is pushed down to the read, not just watched from here", async () => {
    // A client-side timer alone leaves the query running on the server,
    // burning a connection for a page nobody is looking at any more.
    const { reader, calls } = fakeReader(() => []);
    await engineWith(reader).counts(series(), OPTIONS);
    expect(calls[0]?.statementTimeoutMs).toBeGreaterThan(9_000);
    expect(calls[0]?.statementTimeoutMs).toBeLessThanOrEqual(10_000);
  });

  test("a caller that aborts gets a failure that does not blame the engine for timing out", async () => {
    const controller = new AbortController();
    controller.abort();
    const { reader } = fakeReader(() => []);
    const outcome = await engineWith(reader).counts(series(), {
      ...OPTIONS,
      signal: controller.signal,
    });
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.kind).toBe("Unavailable");
    if (outcome.error.kind !== "Unavailable") return;
    expect(outcome.error.detail).toContain("cancelled");
  });

  test("a read that litics itself refuses is an InvalidQuery, not an outage", async () => {
    const { reader } = fakeReader(
      () => new RangeError("litics: step '1 month' must be a fixed interval"),
    );
    const outcome = await engineWith(reader).counts(series(), OPTIONS);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.kind).toBe("InvalidQuery");
  });
});

describe("uniques", () => {
  test("monthly uniques are one read per month, each returning its own merged count", async () => {
    const { reader, calls } = fakeReader((_kind, query) => {
      const from = new Date(String(query.from));
      return [{ bucket: from, actors: (from.getUTCMonth() + 1) * 100 }];
    });
    const outcome = await engineWith(reader).uniques(
      series({
        step: "month",
        bounds: {
          from: at("2024-01-01T00:00:00Z"),
          to: at("2024-04-01T00:00:00Z"),
        },
      }),
      OPTIONS,
    );
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.buckets.map((b) => b.value)).toEqual([100, 200, 300]);
    expect(calls.filter((c) => c.kind === "uniques")).toHaveLength(3);
  });

  test("one budget spans the month loop: later reads get what earlier ones left", async () => {
    let tick = 0;
    const { reader, calls } = fakeReader(() => {
      tick += 1;
      return [];
    });
    const engine = new LiticsAnalyticsEngine({ pool, clock: CLOCK, reader });
    await engine.uniques(
      series({
        step: "month",
        bounds: {
          from: at("2024-01-01T00:00:00Z"),
          to: at("2024-04-01T00:00:00Z"),
        },
      }),
      OPTIONS,
    );
    expect(tick).toBe(3);
    const budgets = calls.map((c) => c.statementTimeoutMs ?? 0);
    expect(budgets[0]).toBeGreaterThanOrEqual(budgets[1] ?? 0);
    expect(budgets[1]).toBeGreaterThanOrEqual(budgets[2] ?? 0);
  });
});

describe("sums", () => {
  test("refuses a measure this deployment does not declare", async () => {
    const { reader, calls } = fakeReader(() => []);
    const outcome = await engineWith(reader).sums(
      { ...series(), measure: "revenue_cents" },
      OPTIONS,
    );
    expect(outcome.ok).toBe(false);
    // Refused before a read was made, not after a round trip.
    expect(calls).toHaveLength(0);
  });
});

describe("breakdowns", () => {
  const breakdown = (over: Partial<BreakdownQuery> = {}): BreakdownQuery => ({
    ...series(),
    by: "os_name",
    order: "desc",
    limit: 10,
    ...over,
  });

  test("is ONE read, grouped over the dimension's own column", async () => {
    // It used to be `limit` queries — one per value, with the values fetched
    // first from the dictionary. The whole point of the group-by is that this
    // is a single read whose rows come from the data.
    const { reader, calls } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "ios", n: 30 },
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "android", n: 12 },
    ]);
    const outcome = await engineWith(reader).countsBy(breakdown(), OPTIONS);
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.rows).toEqual([
      { key: "ios", value: 30 },
      { key: "android", value: 12 },
    ]);
    expect(calls).toHaveLength(1);
    expect((calls[0]?.query as RangeQuery).groupBy).toEqual(["os_name"]);
  });

  test("the whole window is one bin, which is what makes a unique breakdown a merge", async () => {
    // Summing per-bucket cardinalities counts anyone who came back on a second
    // day twice, and nothing downstream could undo it. One bucket, one merged
    // actor set per value.
    const { reader, calls } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "ios", actors: 7 },
    ]);
    const outcome = await engineWith(reader).uniquesBy(breakdown(), OPTIONS);
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.rows).toEqual([{ key: "ios", value: 7 }]);
    expect(calls[0]?.kind).toBe("uniques");
    // Three days of window, one stride of three days: a single bucket.
    expect((calls[0]?.query as RangeQuery).step).toBe("3 days");
  });

  test("keeps the events that carried no value, as a row with a null key", async () => {
    // litics reports them under a null label. Dropping the row makes the bars
    // stop adding up to the total the same question answers as a scalar.
    const { reader } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: null, n: 4 },
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "ios", n: 9 },
    ]);
    const outcome = await engineWith(reader).countsBy(breakdown(), OPTIONS);
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.rows).toEqual([
      { key: "ios", value: 9 },
      { key: null, value: 4 },
    ]);
  });

  test("ranks and cuts to the limit, in the direction asked for", async () => {
    const rows = () => [
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "ios", n: 30 },
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "android", n: 12 },
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "web", n: 41 },
    ];
    const top = await engineWith(fakeReader(rows).reader).countsBy(
      breakdown({ limit: 2 }),
      OPTIONS,
    );
    if (!top.ok) throw new Error(top.error.kind);
    expect(top.value.rows.map((r) => r.key)).toEqual(["web", "ios"]);

    const bottom = await engineWith(fakeReader(rows).reader).countsBy(
      breakdown({ limit: 2, order: "asc" }),
      OPTIONS,
    );
    if (!bottom.ok) throw new Error(bottom.error.kind);
    expect(bottom.value.rows.map((r) => r.key)).toEqual(["android", "ios"]);
  });

  test("breaks ties on the key, so the same question twice draws the same chart", async () => {
    const { reader } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "web", n: 5 },
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "android", n: 5 },
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "ios", n: 5 },
    ]);
    const outcome = await engineWith(reader).countsBy(breakdown(), OPTIONS);
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.rows.map((r) => r.key)).toEqual([
      "android",
      "ios",
      "web",
    ]);
  });

  test("a value that appears twice is a failure, not a silent sum", async () => {
    // One bin means one row per value. Two rows mean the stride was wrong and
    // they are two time buckets — adding them would be right for counts and
    // wrong for uniques, so neither is done.
    const { reader } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), os_name: "ios", n: 3 },
      { bucket: new Date("2024-05-02T00:00:00Z"), os_name: "ios", n: 4 },
    ]);
    const outcome = await engineWith(reader).countsBy(breakdown(), OPTIONS);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.kind).toBe("Unavailable");
    if (outcome.error.kind !== "Unavailable") return;
    expect(outcome.error.detail).toContain("more than one bucket");
  });

  test("an aggregate that is not a number refuses rather than counting as zero", async () => {
    const { reader } = fakeReader(() => [
      {
        bucket: new Date("2024-05-01T00:00:00Z"),
        os_name: "ios",
        n: null as unknown as number,
      },
    ]);
    expect((await engineWith(reader).countsBy(breakdown(), OPTIONS)).ok).toBe(
      false,
    );
  });

  test("a breakdown by a dimension no column carries is refused before a read is made", async () => {
    const { reader, calls } = fakeReader(() => []);
    const outcome = await engineWith(reader).countsBy(
      breakdown({ by: "plan_tier" }),
      OPTIONS,
    );
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.kind).toBe("InvalidQuery");
    if (outcome.error.kind !== "InvalidQuery") return;
    expect(outcome.error.detail).toContain("plan_tier");
    expect(calls).toHaveLength(0);
  });

  test("sumsBy refuses a measure this deployment does not declare", async () => {
    const { reader, calls } = fakeReader(() => []);
    const outcome = await engineWith(reader).sumsBy(
      { ...breakdown(), measure: "revenue_cents" },
      OPTIONS,
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("a broken read is a failure, never an empty table", async () => {
    const { reader } = fakeReader(() => codedError("42P01"));
    expect((await engineWith(reader).countsBy(breakdown(), OPTIONS)).ok).toBe(
      false,
    );
  });

  test("no rows is a real answer: nothing has carried a value for that dimension", async () => {
    const { reader } = fakeReader(() => []);
    const outcome = await engineWith(reader).countsBy(breakdown(), OPTIONS);
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.rows).toEqual([]);
  });
});

describe("funnel", () => {
  const query = {scope: PROJECT, bounds: {from: at("2024-05-01T00:00:00Z"), to: at("2024-06-01T00:00:00Z")}, steps: ["view", "cart", "purchase"] as const};
  test("returns ordered step counts from a single bounded event snapshot", async () => {
    const calls: unknown[] = [];
    const engine = new LiticsAnalyticsEngine({pool,clock:CLOCK,rawReader:{read:async (...args) => {
      calls.push(args);
      return ["view", "cart", "purchase"].map((name,index) => ({ts:Instant.toEpochMillis(query.bounds.from)+index*1000,actor:"a",dimensions:{event_type:name},properties:{}}));
    }}});
    const outcome = await engine.funnel(query,OPTIONS);
    if (!outcome.ok) throw new Error(outcome.error.kind);
    expect(outcome.value.counts).toEqual([1,1,1]);
    expect(calls).toEqual([[query.scope,query.bounds,OPTIONS]]);
  });
  test("a funnel the reader cannot finish is a failure with the reason", async () => {
    const engine = new LiticsAnalyticsEngine({pool,clock:CLOCK,rawReader:{read:async () => {throw new RangeError("The event scan exceeds its memory budget.");}}});
    const outcome = await engine.funnel(query,OPTIONS);
    if (outcome.ok) throw new Error("expected a failure");
    expect(outcome.error.kind).toBe("InvalidQuery");
  });
});

describe("retention", () => {
  test("is a typed absence, and cannot be mistaken for a project with no retention", async () => {
    const { reader, calls } = fakeReader(() => []);
    const outcome = await engineWith(reader).retention(
      {
        scope: PROJECT,
        bounds: {
          from: at("2024-05-01T00:00:00Z"),
          to: at("2024-06-01T00:00:00Z"),
        },
        cohortStep: "week",
        periods: 8,
      },
      OPTIONS,
    );
    expect(outcome.error.feature).toBe("retention");
    expect(calls).toHaveLength(0);
  });
});

describe("Insight grouping and whole-period uniques", () => {
  test("a unique total merges the period in one bin instead of adding daily counts", async () => {
    const { reader, calls } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), actors: 2 },
    ]);
    const result = await engineWith(reader).uniques(
      series({ wholeWindow: true, event: ["view", "buy"] }),
      OPTIONS,
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.value.buckets.map((bucket) => bucket.value)).toEqual([2]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toMatchObject({
      step: "3 days",
      filters: { event_type: ["view", "buy"] },
    });
  });

  test("combinations retain each property, including missing values and separator characters", async () => {
    const { reader, calls } = fakeReader(() => [
      {
        bucket: new Date("2024-05-01T00:00:00Z"),
        country: "A · B",
        locale: "C",
        n: 7,
      },
      {
        bucket: new Date("2024-05-01T00:00:00Z"),
        country: "A",
        locale: "B · C",
        n: 5,
      },
      {
        bucket: new Date("2024-05-01T00:00:00Z"),
        country: null,
        locale: "C",
        n: 1,
      },
    ]);
    const result = await engineWith(reader).countsBy(
      { ...series(), by: ["country", "locale"], order: "desc", limit: 3 },
      OPTIONS,
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(calls[0]?.query).toMatchObject({ groupBy: ["country", "locale"] });
    expect(result.value.rows.map((row) => [row.keys, row.value])).toEqual([
      [["A · B", "C"], 7],
      [["A", "B · C"], 5],
      [[null, "C"], 1],
    ]);
    expect(new Set(result.value.rows.map((row) => row.key)).size).toBe(3);
  });

  test("a malformed combination fails instead of dropping its value", async () => {
    const { reader } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), country: "US", n: 9 },
    ]);
    const result = await engineWith(reader).countsBy(
      { ...series(), by: ["country", "locale"], order: "desc", limit: 3 },
      OPTIONS,
    );
    expect(result.ok).toBe(false);
  });

  test("a split trend fills missing buckets separately for each group", async () => {
    const { reader, calls } = fakeReader(() => [
      { bucket: new Date("2024-05-01T00:00:00Z"), country: "US", n: 3 },
      { bucket: new Date("2024-05-03T00:00:00Z"), country: "FR", n: 4 },
    ]);
    const result = await engineWith(reader).counts(
      series({ by: "country" }),
      OPTIONS,
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(calls[0]?.query).toMatchObject({ groupBy: ["country"] });
    expect(
      result.value.groups?.map((group) => [
        group.key,
        group.buckets.map((bucket) => bucket.value),
      ]),
    ).toEqual([
      ["US", [3, 0, 0]],
      ["FR", [0, 0, 4]],
    ]);
    expect(result.value.buckets).toEqual([]);
  });
});
