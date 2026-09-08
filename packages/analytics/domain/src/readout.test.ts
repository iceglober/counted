import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import { Funnel, FunnelStep } from "./funnel";
import { Trend } from "./measure";
import { Outcome, Readout, ReadoutId, type ReadoutValue } from "./readout";
import { Window } from "./window";

const now = Instant.fromEpochMillis(1_800_000_000_000);
const id = ReadoutId("tile_7");

describe("an outcome has no zero value", () => {
  test("a failure carries no value a renderer could reach", () => {
    const failed = Readout.failed(id, { kind: "Unavailable", detail: "pool exhausted" });
    expect(failed.ok).toBe(false);
    // @ts-expect-error there is no `value` on the failed branch — this is the
    // whole point. v1's loader mapped every rejection to emptyData(), so a
    // broken query and an empty project rendered identically.
    expect(failed.value).toBeUndefined();
  });

  test("a caller must read `ok` before it can reach a value", () => {
    const outcome: Outcome<number> = Outcome.answered(42, now);
    // @ts-expect-error `value` is not on the union until `ok` is narrowed
    outcome.value;
    if (!outcome.ok) return;
    expect(outcome.value).toBe(42);
    expect(outcome.computedAt).toBe(now);
  });

  test("there is no fallback helper, because a fallback is the zero value", () => {
    expect(Object.keys(Outcome)).not.toContain("unwrapOr");
    expect(Object.keys(Outcome)).not.toContain("orEmpty");
  });
});

describe("Outcome.map", () => {
  test("carries the computation time forward rather than restamping it", () => {
    const mapped = Outcome.map(Outcome.answered(2, now), (n) => n * 3);
    expect(mapped.ok && mapped.value).toBe(6);
    expect(mapped.ok && mapped.computedAt).toBe(now);
  });

  test("leaves a failure alone", () => {
    const failure = Outcome.failed<number>({ kind: "Timeout", budget: Duration.seconds(5) });
    const mapped = Outcome.map(failure, (n) => n * 3);
    expect(mapped.ok).toBe(false);
    expect(mapped).toEqual(failure);
  });
});

describe("readout values", () => {
  test("every shape an analysis can produce has a value shape", () => {
    const scalar: ReadoutValue = { shape: "scalar", value: 12, trend: Trend.between(12, 10) };
    const series: ReadoutValue = {
      shape: "series",
      points: [{ bucketStart: now, value: 3 }],
    };
    const breakdown: ReadoutValue = { shape: "breakdown", rows: [{ label: "en-GB", value: 4 }] };
    const funnel = Funnel.summarize(
      Funnel.of([FunnelStep.of(["a"]), FunnelStep.of(["b"])], Window.lastDays(7)),
      [10, 5],
    );
    expect(funnel.ok).toBe(true);
    if (!funnel.ok) return;
    const asFunnel: ReadoutValue = { shape: "funnel", result: funnel.value };
    expect([scalar, series, breakdown, asFunnel].map(Readout.shapeOf)).toEqual([
      "scalar",
      "series",
      "breakdown",
      "funnel",
    ]);
  });

  test("a readout keeps its correlation id on both branches", () => {
    const answered = Readout.answered(id, { shape: "scalar", value: 1 }, now);
    const failed = Readout.failed(id, { kind: "InvalidQuery", detail: "no such measure" });
    expect(answered.id).toBe(id);
    expect(failed.id).toBe(id);
  });
});

describe("retrying", () => {
  test("a timeout or an unavailable engine might answer next time", () => {
    expect(Readout.isRetriable({ kind: "Timeout", budget: Duration.seconds(5) })).toBe(true);
    expect(Readout.isRetriable({ kind: "Unavailable", detail: "restarting" })).toBe(true);
  });

  test("a bad query and a missing capability never will", () => {
    // Retrying these is how a dashboard becomes a load generator.
    expect(Readout.isRetriable({ kind: "InvalidQuery", detail: "bad grain" })).toBe(false);
    expect(Readout.isRetriable({ kind: "NotImplemented", feature: "retention" })).toBe(false);
  });

  test("the missing capabilities are named, so they can be counted", () => {
    const features: ReadonlyArray<"retention" | "group_by" | "nested_predicates"> = [
      "retention",
      "group_by",
      "nested_predicates",
    ];
    for (const feature of features) {
      expect(Readout.isRetriable({ kind: "NotImplemented", feature })).toBe(false);
    }
  });
});
