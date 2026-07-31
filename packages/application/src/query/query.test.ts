/**
 * Planning, assembly and batching — with no store, no HTTP, no database.
 *
 * The two v1 defects these exist to make unrepeatable:
 *
 *   A 24-tile dashboard issued 24 serialised queries. Here every question in a
 *   render goes to the store in one call, and a test counts the calls.
 *
 *   Any rejection became `emptyData()`, so a broken query and an empty project
 *   drew the same blank chart. Here a failure is a readout that says so, and
 *   one failing tile does not take the others with it.
 */

import { describe, expect, test } from "bun:test";
import {
  Analysis,
  Dimension,
  Duration,
  FieldRef,
  FunnelStep,
  Instant,
  Measure,
  ProjectId,
  TileId,
  TimeAxis,
  Window,
  type Funnel,
  type Retention,
} from "@counted/domain";
import type {
  AnalyticalStore,
  BatchOutcome,
  Outcome,
  StoreRequest,
  StoreResult,
} from "@counted/ports";
import { RequestId } from "@counted/ports";
import { assemble } from "./assemble";
import { explainPlanError, planQuestion, type Question } from "./plan";
import { runQuestions, type Ask } from "./run";

const PRJ = ProjectId("prj_1");
const NOW = Instant.fromEpochMillis(Date.parse("2026-03-17T14:37:00.000Z"));
const R0 = RequestId("r0");

const analysisQuestion = (analysis: Analysis): Question => ({ kind: "analysis", analysis });

const funnel: Funnel = {
  steps: [FunnelStep.of(["view"]), FunnelStep.of(["signup"])],
  window: Window.lastDays(7),
  conversionWindow: Duration.hours(24),
  basis: "visit",
};

const retention: Retention = {
  window: Window.lastWeeks(4),
  grain: "week",
  periods: 3,
  basis: "person",
};

const mustPlan = (question: Question) => {
  const planned = planQuestion(R0, PRJ, question, NOW);
  if (!planned.ok) throw new Error(`expected a plan: ${JSON.stringify(planned.error)}`);
  return planned.value;
};

describe("a question becomes the store request its own shape implies", () => {
  test("no grouping is a scalar", () => {
    expect(mustPlan(analysisQuestion(Analysis.countOverWindow(Window.lastDays(7)))).request.kind).toBe("scalar");
  });

  test("grouping by time is a series, and carries the axis", () => {
    const plan = mustPlan(analysisQuestion(Analysis.timeSeries(Measure.count(), Window.lastDays(7), "day")));
    expect(plan.request.kind).toBe("series");
    if (plan.request.kind === "series") {
      // The domain computed the edges. There is no second bucketing
      // implementation for SQL to disagree with — v1 had `time_bucket` on one
      // path and `date_trunc` on another, and they disagreed about weeks.
      expect(plan.request.axis.edges.length).toBe(TimeAxis.bucketCount(plan.request.axis) + 1);
    }
  });

  test("grouping by a field is a breakdown", () => {
    const analysis = Analysis.breakdown(Measure.count(), FieldRef.system("os_name"), Window.lastDays(7));
    expect(mustPlan(analysisQuestion(analysis)).request.kind).toBe("breakdown");
  });

  test("a funnel is a sequence and retention is cohorts", () => {
    expect(mustPlan({ kind: "funnel", funnel }).request.kind).toBe("sequence");
    expect(mustPlan({ kind: "retention", retention }).request.kind).toBe("cohorts");
  });

  test("the branch comes from the shape, not from whether a field happened to be set", () => {
    // v1 inferred it from whether `groupBy` was truthy, which is how a
    // breakdown that also grouped by time silently became something else.
    const both: Analysis = {
      measure: Measure.count(),
      window: Window.lastDays(7),
      groupBy: [Dimension.field(FieldRef.system("os_name")), Dimension.time("day")],
    };
    // Time wins: a series with a field dimension is still a series.
    expect(mustPlan(analysisQuestion(both)).request.kind).toBe("series");
  });
});

describe("the window is resolved once, here, into absolute bounds", () => {
  test("every request carries bounds the store does not have to compute", () => {
    // An adapter that resolves "last 7 days" itself is an adapter with a
    // clock, and a clock the domain cannot see is a clock that can disagree.
    for (const question of [
      analysisQuestion(Analysis.countOverWindow(Window.lastDays(7))),
      { kind: "funnel", funnel } as Question,
      { kind: "retention", retention } as Question,
    ]) {
      const { bounds } = mustPlan(question).request;
      expect(Instant.toEpochMillis(bounds.to)).toBeGreaterThan(Instant.toEpochMillis(bounds.from));
      expect(bounds.to).toBe(NOW);
    }
  });

  test("an absolute window is passed through unchanged", () => {
    const from = Instant.fromEpochMillis(Date.parse("2026-01-01T00:00:00.000Z"));
    const to = Instant.fromEpochMillis(Date.parse("2026-02-01T00:00:00.000Z"));
    const plan = mustPlan(analysisQuestion(Analysis.countOverWindow(Window.between(from, to))));
    expect(plan.request.bounds).toEqual({ from, to });
  });
});

describe("an unanswerable question is refused before it reaches the store", () => {
  test("an invalid analysis does not become a query", () => {
    const bad: Analysis = { measure: Measure.count(), window: Window.lastDays(7), events: [""] };
    const planned = planQuestion(R0, PRJ, analysisQuestion(bad), NOW);
    expect(planned.ok).toBe(false);
  });

  test("a one-step funnel is refused — that is just a count", () => {
    const single: Funnel = { ...funnel, steps: [FunnelStep.of(["view"])] };
    const planned = planQuestion(R0, PRJ, { kind: "funnel", funnel: single }, NOW);
    expect(planned.ok).toBe(false);
  });

  test("a window and grain that would produce too many buckets is refused with the numbers", () => {
    // Better than a query that returns ten thousand points and a browser that
    // stops responding.
    const huge = Analysis.timeSeries(Measure.count(), Window.lastMonths(24), "hour");
    const planned = planQuestion(R0, PRJ, analysisQuestion(huge), NOW);
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.error.kind).toBe("TooManyBuckets");
      expect(explainPlanError(planned.error)).toContain("coarser grain");
    }
  });

  test("the truncation guard does not fire on large-but-answerable windows", () => {
    // The guard must catch a silently-shortened axis without refusing the
    // queries people actually run. A year of daily buckets is 365, and 300
    // days of hourly buckets is 7,200 — both well inside the cap.
    for (const analysis of [
      Analysis.timeSeries(Measure.count(), Window.lastMonths(12), "day"),
      Analysis.timeSeries(Measure.count(), Window.lastDays(300), "hour"),
      Analysis.timeSeries(Measure.count(), Window.lastWeeks(52), "week"),
    ]) {
      expect(planQuestion(R0, PRJ, analysisQuestion(analysis), NOW).ok).toBe(true);
    }
  });

  test("an axis that would be truncated is refused, whatever the cap does", () => {
    // `TimeAxis.build` stops at MAX_BUCKETS rather than overflowing, so the
    // count never exceeds the cap and comparing against it would never fire.
    // What is detectable is that the axis stops short of the window's end.
    for (const analysis of [
      Analysis.timeSeries(Measure.count(), Window.lastDays(500), "hour"),
      Analysis.timeSeries(Measure.count(), Window.lastMonths(24), "hour"),
    ]) {
      const planned = planQuestion(R0, PRJ, analysisQuestion(analysis), NOW);
      expect(planned.ok).toBe(false);
      if (!planned.ok) expect(planned.error.kind).toBe("TooManyBuckets");
    }
  });

  test("every plan error explains itself in a sentence", () => {
    const errors = [
      { kind: "TooManyBuckets", requested: 20_000, max: 10_000 },
      { kind: "InvalidAnalysis", error: { kind: "EmptyEventName" } },
      { kind: "InvalidFunnel", error: { kind: "TooFewSteps", count: 1 } },
      { kind: "InvalidRetention", error: { kind: "NonPositivePeriods", periods: 0 } },
    ] as const;
    for (const error of errors) {
      const text = explainPlanError(error);
      expect(text.length).toBeGreaterThan(10);
      expect(text.endsWith(".")).toBe(true);
    }
  });
});

describe("assembly turns raw counts into the shape the client reads", () => {
  test("a series is dated from the same edges the store was handed", () => {
    const plan = mustPlan(analysisQuestion(Analysis.timeSeries(Measure.count(), Window.lastDays(3), "day")));
    if (plan.request.kind !== "series") throw new Error("expected a series");
    const buckets = TimeAxis.bucketCount(plan.request.axis);
    const result: StoreResult = { kind: "series", values: new Array(buckets).fill(2) };

    const value = assemble(plan, result);
    expect(value.ok).toBe(true);
    if (value.ok && value.value.shape === "series") {
      expect(value.value.points).toHaveLength(buckets);
      expect(value.value.points[0]!.bucketStart).toBe(plan.request.axis.edges[0]!);
    }
  });

  test("a short series is refused rather than silently shifting every point", () => {
    const plan = mustPlan(analysisQuestion(Analysis.timeSeries(Measure.count(), Window.lastDays(7), "day")));
    const value = assemble(plan, { kind: "series", values: [1, 2] });
    expect(value.ok).toBe(false);
  });

  test("funnel rates are derived in the domain, not in SQL", () => {
    const plan = mustPlan({ kind: "funnel", funnel });
    const value = assemble(plan, { kind: "sequence", counts: [100, 25] });
    expect(value.ok).toBe(true);
    if (value.ok && value.value.shape === "funnel") {
      expect(value.value.result.steps[1]!.rate).toBe(25);
      expect(value.value.result.steps[1]!.droppedOff).toBe(75);
    }
  });

  test("a rising funnel is refused, not rendered", () => {
    // More people reaching step 2 than step 1 means the query is wrong. v1
    // could not detect it, because its conjunctive query made monotonicity
    // accidental rather than checked.
    const plan = mustPlan({ kind: "funnel", funnel });
    expect(assemble(plan, { kind: "sequence", counts: [10, 50] }).ok).toBe(false);
  });

  test("an empty first funnel step does not produce NaN", () => {
    // v1 divided without guarding and rendered "NaN%".
    const plan = mustPlan({ kind: "funnel", funnel });
    const value = assemble(plan, { kind: "sequence", counts: [0, 0] });
    expect(value.ok).toBe(true);
    if (value.ok && value.value.shape === "funnel") {
      for (const step of value.value.result.steps) expect(Number.isFinite(step.rate)).toBe(true);
    }
  });

  test("retention comes back as a grid with unreached periods left null", () => {
    const plan = mustPlan({ kind: "retention", retention });
    const cohortStart = Instant.fromEpochMillis(Date.parse("2026-03-09T00:00:00.000Z"));
    const value = assemble(plan, {
      kind: "cohorts",
      sizes: [{ cohortStart, size: 10 }],
      observations: [{ cohortStart, periodStart: cohortStart, returned: 10 }],
    });
    expect(value.ok).toBe(true);
    if (value.ok && value.value.shape === "retention") {
      const cells = value.value.grid.cohorts[0]!.cells;
      expect(cells[0]).not.toBeNull();
      // A period that has not begun is null, never zero. v1 conflated them, so
      // "nobody came back" and "we cannot know yet" looked identical.
      expect(cells.some((cell) => cell === null)).toBe(true);
    }
  });

  test("a result of the wrong kind is reported, not coerced", () => {
    // Reading a scalar as a series would draw a one-point chart with no
    // indication anything was wrong.
    const plan = mustPlan(analysisQuestion(Analysis.timeSeries(Measure.count(), Window.lastDays(3), "day")));
    const value = assemble(plan, { kind: "scalar", value: 5 });
    expect(value.ok).toBe(false);
    if (!value.ok) expect(value.error.detail).toContain("scalar");
  });
});

// ── Batching ─────────────────────────────────────────────────────────────────

const stubStore = (
  answer: (r: StoreRequest) => Outcome<StoreResult>,
  calls: StoreRequest[][] = [],
): AnalyticalStore => ({
  executeBatch: async (requests): Promise<BatchOutcome> => {
    calls.push([...requests]);
    return {
      results: new Map(requests.map((r) => [r.id, answer(r)])),
      stats: { statements: requests.length, totalMs: 1, coalesced: 0 },
    };
  },
  capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
});

const answered = (value: number): Outcome<StoreResult> => ({
  ok: true,
  value: { kind: "scalar", value },
  from: "store",
  computedAt: NOW,
});

const asks = (count: number): Ask[] =>
  Array.from({ length: count }, (_, i) => ({
    id: TileId(`tile_${i}`),
    project: PRJ,
    question: analysisQuestion(Analysis.countOverWindow(Window.lastDays(7))),
  }));

describe("a whole dashboard is one call to the store", () => {
  test("twenty-four tiles produce one batch, not twenty-four queries", async () => {
    // The v1 number, exactly: a 24-tile board looped and awaited each query in
    // turn against a pool of 20 shared with ingestion.
    const calls: StoreRequest[][] = [];
    const store = stubStore(() => answered(1), calls);

    const { readouts } = await runQuestions(store, asks(24), {
      now: NOW,
      deadlineMs: 5_000,
      traceId: "t",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(24);
    expect(readouts).toHaveLength(24);
  });

  test("answers come back in the order the caller asked", async () => {
    const store = stubStore((r) => answered(Number(String(r.id).slice(1))));
    const { readouts } = await runQuestions(store, asks(5), { now: NOW, deadlineMs: 5_000, traceId: "t" });
    expect(readouts.map((r) => String(r.tile))).toEqual(["tile_0", "tile_1", "tile_2", "tile_3", "tile_4"]);
  });

  test("two tiles asking the identical question still get their own answers", async () => {
    const store = stubStore(() => answered(7));
    const same = [asks(1)[0]!, { ...asks(1)[0]!, id: TileId("other") }];
    const { readouts } = await runQuestions(store, same, { now: NOW, deadlineMs: 5_000, traceId: "t" });
    expect(readouts).toHaveLength(2);
    expect(readouts.map((r) => String(r.tile)).sort()).toEqual(["other", "tile_0"]);
  });
});

describe("a failure is a readout, never a blank chart", () => {
  test("a store error becomes a stated failure", async () => {
    const store = stubStore(() => ({
      ok: false,
      error: { code: "timeout", budgetMs: 500, retriable: true },
    }));
    const { readouts } = await runQuestions(store, asks(1), { now: NOW, deadlineMs: 500, traceId: "t" });

    expect(readouts[0]!.ok).toBe(false);
    if (!readouts[0]!.ok) {
      // v1 turned this into emptyData(), so a broken query and an empty
      // project rendered identically.
      expect(readouts[0]!.failure.code).toBe("timeout");
      expect(readouts[0]!.failure.retriable).toBe(true);
      expect(readouts[0]!.failure.detail).toContain("500ms");
    }
  });

  test("one failing tile does not take the others with it", async () => {
    let n = 0;
    const store = stubStore(() =>
      n++ === 1
        ? { ok: false, error: { code: "store_unavailable", detail: "pool exhausted", retriable: true } }
        : answered(3),
    );
    const { readouts } = await runQuestions(store, asks(4), { now: NOW, deadlineMs: 5_000, traceId: "t" });

    expect(readouts.filter((r) => r.ok)).toHaveLength(3);
    expect(readouts.filter((r) => !r.ok)).toHaveLength(1);
  });

  test("an unplannable question never reaches the store, and still gets an answer", async () => {
    const calls: StoreRequest[][] = [];
    const store = stubStore(() => answered(1), calls);
    const mixed: Ask[] = [
      asks(1)[0]!,
      {
        id: TileId("broken"),
        project: PRJ,
        question: analysisQuestion({ measure: Measure.count(), window: Window.lastDays(7), events: [""] }),
      },
    ];

    const { readouts } = await runQuestions(store, mixed, { now: NOW, deadlineMs: 5_000, traceId: "t" });

    // One request, not two: the broken tile was never asked.
    expect(calls[0]).toHaveLength(1);
    expect(readouts).toHaveLength(2);
    expect(readouts.find((r) => String(r.tile) === "broken")!.ok).toBe(false);
  });

  test("a store that answers fewer requests than it was given is caught", async () => {
    // Silence for one question must not render as a blank tile.
    const store: AnalyticalStore = {
      executeBatch: async () => ({ results: new Map(), stats: { statements: 0, totalMs: 0, coalesced: 0 } }),
      capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
    };
    const { readouts } = await runQuestions(store, asks(2), { now: NOW, deadlineMs: 5_000, traceId: "t" });
    expect(readouts).toHaveLength(2);
    for (const readout of readouts) expect(readout.ok).toBe(false);
  });

  test("every question failing still returns one readout each", async () => {
    const store = stubStore(() => ({
      ok: false,
      error: { code: "store_unavailable", detail: "down", retriable: true },
    }));
    const { readouts } = await runQuestions(store, asks(3), { now: NOW, deadlineMs: 5_000, traceId: "t" });
    expect(readouts).toHaveLength(3);
  });

  test("no questions at all is not a store call", async () => {
    const calls: StoreRequest[][] = [];
    const store = stubStore(() => answered(0), calls);
    const { readouts, statements } = await runQuestions(store, [], { now: NOW, deadlineMs: 5_000, traceId: "t" });
    expect(calls).toHaveLength(0);
    expect(readouts).toHaveLength(0);
    expect(statements).toBe(0);
  });
});
