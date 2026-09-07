import { describe, expect, test } from "bun:test";

import {
  Analysis,
  DimensionCatalog,
  FieldRef,
  Measure,
  Predicate,
  Window,
} from "@counted/analytics-domain";
import type {
  AnalyticsEngine,
  Breakdown,
  EngineOutcome,
  FunnelCounts,
  NotImplemented,
  Series,
  SeriesQuery,
  SumsQuery,
} from "@counted/analytics-ports";
import { Duration, Instant } from "@counted/kernel";

import { engineObserver, stepFor } from "./observe";
import { aMonitor, countingIds, scalarAnalysis, T0, uniqueVisitsAnalysis } from "./testing";
import { Threshold } from "@counted/dashboarding-domain";

const CATALOG = DimensionCatalog.of(["event_type", "os_name", "locale"], ["country"]);

const series = (values: readonly number[]): Series => ({
  buckets: values.map((value, index) => ({
    start: Instant.plus(T0, Duration.hours(index)),
    value,
  })),
});

type Recorded = { series: SeriesQuery[]; sums: SumsQuery[]; uniques: SeriesQuery[] };

const engineReturning = (
  outcome: EngineOutcome<Series>,
): { engine: AnalyticsEngine; seen: Recorded } => {
  const seen: Recorded = { series: [], sums: [], uniques: [] };
  const engine: AnalyticsEngine = {
    counts: async (query) => {
      seen.series.push(query);
      return outcome;
    },
    uniques: async (query) => {
      seen.uniques.push(query);
      return outcome;
    },
    sums: async (query) => {
      seen.sums.push(query);
      return outcome;
    },
    // A monitor evaluates a scalar, so a breakdown is never asked for here.
    countsBy: async (): Promise<EngineOutcome<Breakdown>> => ({
      ok: false,
      error: { kind: "Unavailable", detail: "not used" },
    }),
    uniquesBy: async (): Promise<EngineOutcome<Breakdown>> => ({
      ok: false,
      error: { kind: "Unavailable", detail: "not used" },
    }),
    sumsBy: async (): Promise<EngineOutcome<Breakdown>> => ({
      ok: false,
      error: { kind: "Unavailable", detail: "not used" },
    }),
    funnel: async (): Promise<EngineOutcome<FunnelCounts>> => ({
      ok: false,
      error: { kind: "Unavailable", detail: "not used" },
    }),
    retention: async (): Promise<NotImplemented<"retention">> => ({
      ok: false,
      error: { kind: "NotImplemented", feature: "retention" },
    }),
  };
  return { engine, seen };
};

const observerFor = (outcome: EngineOutcome<Series>) => {
  const { engine, seen } = engineReturning(outcome);
  return {
    seen,
    observe: engineObserver({
      engine,
      deadline: Duration.seconds(5),
      catalog: CATALOG,
      ids: countingIds("trace"),
    }),
  };
};

test("custom property filters reach the scan engine intact for monitors", async () => {
  const property = Predicate.eq(FieldRef.property("url"), "/pricing");
  const analysis = { ...scalarAnalysis(), where: property };
  const { engine, seen } = engineReturning({ ok: true, value: series([2, 3]), computedAt: T0 });
  const observe = engineObserver({ engine, deadline: Duration.seconds(5), catalog: CATALOG, ids: countingIds() });
  const answer = await observe(aMonitor({ threshold: Threshold.above(1), analysis }), T0);
  expect(answer).toMatchObject({ kind: "observed", value: 5 });
  expect(seen.series[0]?.predicate).toEqual(property);
});

describe("observing a monitor", () => {
  test("a dense series is collapsed by the analysis' own summary statistic", async () => {
    const { observe } = observerFor({ ok: true, value: series([1, 9, 2]), computedAt: T0 });
    const monitor = aMonitor({
      threshold: Threshold.above(5),
      analysis: { ...scalarAnalysis(), summary: "peak" } as Analysis,
    });

    expect(await observe(monitor, T0)).toEqual({ kind: "observed", value: 9, computedAt: T0 });
  });

  /**
   * The failure this file exists to prevent. `Threshold.below(100)` is breached
   * by zero, so an engine failure read as "0" pages somebody at 3am claiming
   * traffic collapsed. Every failure kind must come back without a number.
   */
  test.each([
    ["Timeout", { kind: "Timeout" as const, budget: Duration.seconds(5) }, true],
    ["Unavailable", { kind: "Unavailable" as const, detail: "down" }, true],
    ["InvalidQuery", { kind: "InvalidQuery" as const, detail: "no such index" }, false],
    ["NotImplemented", { kind: "NotImplemented" as const, feature: "group_by" as const }, false],
  ])("an engine %s never becomes a number", async (_name, error, retriable) => {
    const { observe } = observerFor({ ok: false, error });
    const observation = await observe(aMonitor({ threshold: Threshold.below(100) }), T0);

    expect(observation.kind).toBe("unobservable");
    if (observation.kind !== "unobservable") throw new Error("unreachable");
    expect(observation.retriable).toBe(retriable);
  });

  test("no buckets at all is no data, not zero", async () => {
    const { observe } = observerFor({ ok: true, value: series([]), computedAt: T0 });
    // `peak` of nothing is not zero; `SummaryStat.apply` says so by returning
    // null, and this is the only place that null is allowed to mean anything.
    const monitor = aMonitor({
      threshold: Threshold.below(100),
      analysis: { ...scalarAnalysis(), summary: "peak" } as Analysis,
    });

    expect(await observe(monitor, T0)).toEqual({ kind: "no-data" });
  });

  test("an analysis that is not scalar is refused rather than partly answered", async () => {
    const { observe } = observerFor({ ok: true, value: series([1]), computedAt: T0 });
    const monitor = aMonitor({
      threshold: Threshold.above(1),
      analysis: Analysis.timeSeries(Measure.count(), Window.lastDays(7)),
    });

    const observation = await observe(monitor, T0);
    expect(observation.kind).toBe("unobservable");
    if (observation.kind !== "unobservable") throw new Error("unreachable");
    expect(observation.detail).toContain("one number");
    expect(observation.retriable).toBe(false);
  });

  /**
   * litics follows one actor and this deployment's actor is the visit. Unique
   * *people* has no answer — and answering with unique visits instead would
   * report a larger number, keeping an `above` threshold permanently breached.
   */
  test("unique people is refused because this deployment counts visits", async () => {
    const { observe, seen } = observerFor({ ok: true, value: series([5]), computedAt: T0 });
    const monitor = aMonitor({
      threshold: Threshold.above(1),
      analysis: { ...uniqueVisitsAnalysis(), measure: Measure.uniquePeople() } as Analysis,
    });

    const observation = await observe(monitor, T0);
    expect(observation.kind).toBe("unobservable");
    expect(seen.uniques).toHaveLength(0);
  });

  test("a filter the index cannot serve is refused, with the domain's own reason", async () => {
    const { observe, seen } = observerFor({ ok: true, value: series([1]), computedAt: T0 });
    const monitor = aMonitor({
      threshold: Threshold.above(1),
      analysis: {
        ...scalarAnalysis(),
        where: Predicate.eq(FieldRef.dimension("country"), "GB"),
      } as Analysis,
    });

    const observation = await observe(monitor, T0);
    expect(observation.kind).toBe("unobservable");
    if (observation.kind !== "unobservable") throw new Error("unreachable");
    // "not collected yet", not "no such field", and not an empty series.
    expect(observation.detail).toContain("country");
    expect(seen.series).toHaveLength(0);
  });

  test("an event restriction travels as `event`, and the rest as flat filters", async () => {
    const { observe, seen } = observerFor({ ok: true, value: series([3]), computedAt: T0 });
    const monitor = aMonitor({
      threshold: Threshold.above(1),
      analysis: {
        ...scalarAnalysis(),
        where: Predicate.and(
          Predicate.eq(FieldRef.dimension("event_type"), "signup"),
          Predicate.eq(FieldRef.dimension("os_name"), "iOS"),
        ),
      } as Analysis,
    });

    await observe(monitor, T0);

    expect(seen.series).toHaveLength(1);
    expect(seen.series[0]?.event).toBe("signup");
    expect(seen.series[0]?.filters).toEqual({ os_name: "iOS" });
    expect(seen.series[0]?.scope).toEqual({ level: "project", project: monitor.project });
  });

  test("a sum names its measure so the engine can refuse an undeclared one", async () => {
    const { observe, seen } = observerFor({ ok: true, value: series([2]), computedAt: T0 });
    const monitor = aMonitor({
      threshold: Threshold.above(1),
      analysis: { ...scalarAnalysis(), measure: Measure.sum("revenue") } as Analysis,
    });

    await observe(monitor, T0);
    expect(seen.sums[0]?.measure).toBe("revenue");
  });

  /**
   * A monitor and a chart over the same window must read the same store, or
   * the monitor can silently reach past a retention the chart beside it
   * respects.
   */
  test("a scalar is measured at the step a series over the same window would use", () => {
    for (const window of [Window.lastHours(6), Window.lastDays(30), Window.lastMonths(12)]) {
      expect(stepFor(window)).toBe(Window.defaultGrain(window));
    }
  });
});
