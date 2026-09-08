import { describe, expect, test } from "bun:test";
import { Duration } from "@counted/kernel";
import { ENGINE_FUNNEL_STEPS, Funnel, FunnelStep } from "./funnel";
import { FieldRef } from "./field";
import { Predicate } from "./predicate";
import { ConversionWindow, Window } from "./window";

const window = Window.lastDays(7);
const step = (name: string) => FunnelStep.of([name]);
const threeSteps = [step("view"), step("add_to_cart"), step("purchase")];

describe("a funnel is ordered and bounded", () => {
  test("it carries a conversion window that cannot be a plain duration", () => {
    const f = Funnel.of(threeSteps, window, ConversionWindow.of(Duration.hours(2)));
    expect(ConversionWindow.toMillis(f.conversionWindow)).toBe(
      Duration.toMillis(Duration.hours(2)),
    );
    // @ts-expect-error a Duration is not a ConversionWindow
    Funnel.of(threeSteps, window, Duration.hours(2));
  });

  test("step order is the definition's order, and the key records it", () => {
    const forwards = Funnel.of(threeSteps, window);
    const backwards = Funnel.of([...threeSteps].reverse(), window);
    expect(Funnel.toKey(forwards)).not.toBe(Funnel.toKey(backwards));
  });

  test("a step carries a predicate — v1 discarded these entirely", () => {
    const priced = FunnelStep.of(
      ["purchase"],
      Predicate.gt(FieldRef.property("amount"), 100),
      "Big purchase",
    );
    const f = Funnel.of([step("view"), priced], window);
    expect(f.steps[1]?.where).toBeDefined();
    expect(Funnel.toKey(f)).toContain("gt(prop:amount");
  });

  test("visits are the default basis, because a visit is what an anonymous journey is", () => {
    expect(Funnel.of(threeSteps, window).basis).toBe("visit");
    expect(Funnel.spansVisits(Funnel.of(threeSteps, window))).toBe(false);
    expect(Funnel.requiresPerson(Funnel.of(threeSteps, window, undefined, "person"))).toBe(true);
  });
});

describe("defects", () => {
  test("one step is not a funnel", () => {
    expect(Funnel.defects(Funnel.of([step("view")], window)).map((d) => d.kind)).toEqual([
      "TooFewSteps",
    ]);
  });

  test("a step with no events, and a blank event name, are both named", () => {
    const f = Funnel.of([FunnelStep.of([]), FunnelStep.of([" "])], window);
    expect(Funnel.defects(f).map((d) => d.kind)).toEqual(["StepWithoutEvents", "EmptyEventName"]);
  });

  test("a zero conversion window gives nobody time to convert", () => {
    const f = Funnel.of(threeSteps, window, ConversionWindow.of(Duration.ZERO));
    expect(Funnel.defects(f).map((d) => d.kind)).toEqual(["NonPositiveConversionWindow"]);
  });

  test("a well-formed funnel has no defects", () => {
    expect(Funnel.defects(Funnel.of(threeSteps, window))).toEqual([]);
  });
});

describe("what the engine can serve today", () => {
  test("exactly three bare steps is the answerable shape", () => {
    expect(Funnel.answerability(Funnel.of(threeSteps, window)).kind).toBe("indexed");
    expect(ENGINE_FUNNEL_STEPS).toBe(3);
  });

  test("a four-step funnel is unanswerable, not silently truncated", () => {
    const f = Funnel.of([...threeSteps, step("review")], window);
    const a = Funnel.answerability(f);
    expect(a.kind).toBe("unanswerable");
    if (a.kind !== "unanswerable") return;
    expect(a.reasons[0]).toEqual({ kind: "StepCountUnsupported", count: 4, supported: 3 });
  });

  test("a per-step filter is unanswerable, not dropped — v1 dropped it", () => {
    const f = Funnel.of(
      [step("view"), step("cart"), FunnelStep.of(["purchase"], Predicate.gt(FieldRef.property("amount"), 100))],
      window,
    );
    const a = Funnel.answerability(f);
    expect(a.kind).toBe("unanswerable");
    if (a.kind !== "unanswerable") return;
    expect(a.reasons).toContainEqual({ kind: "StepPredicateUnsupported", index: 2 });
  });

  test("a step that accepts two events is unanswerable", () => {
    const f = Funnel.of([FunnelStep.of(["view", "peek"]), step("cart"), step("purchase")], window);
    expect(Funnel.answerability(f).kind).toBe("unanswerable");
  });
});

describe("summarize", () => {
  const f = Funnel.of(threeSteps, window);

  test("rates are relative to the previous step and to the first", () => {
    const result = Funnel.summarize(f, [1000, 400, 100]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.steps.map((s) => s.rate)).toEqual([100, 40, 25]);
    expect(result.value.steps.map((s) => s.cumulativeRate)).toEqual([100, 40, 10]);
    expect(result.value.steps.map((s) => s.droppedOff)).toEqual([0, 600, 300]);
    expect(result.value.overallRate).toBe(10);
  });

  test("counts that rise mean the engine answered a different question", () => {
    // v1 could not detect this: its conjunctive query made monotonicity
    // accidental rather than checked.
    const result = Funnel.summarize(f, [100, 200, 50]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NonMonotonicCounts");
  });

  test("a count for every step, or it is a mismatch", () => {
    const result = Funnel.summarize(f, [100, 50]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("CountMismatch");
  });

  test("an empty first step gives zero, never NaN", () => {
    // v1 divided without guarding and rendered "NaN%".
    const result = Funnel.summarize(f, [0, 0, 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const s of result.value.steps) expect(Number.isFinite(s.rate)).toBe(true);
    expect(result.value.overallRate).toBe(0);
  });

  test("the worst leak is by absolute loss, and a lossless funnel has none", () => {
    const leaky = Funnel.summarize(f, [1000, 400, 100]);
    const lossless = Funnel.summarize(f, [10, 10, 10]);
    expect(leaky.ok && Funnel.biggestDropOff(leaky.value)?.droppedOff).toBe(600);
    expect(lossless.ok && Funnel.biggestDropOff(lossless.value)).toBeNull();
  });
});
