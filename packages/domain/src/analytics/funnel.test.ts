import { describe, expect, test } from "bun:test";
import { Duration } from "../shared";
import { FieldRef } from "./field";
import { Predicate } from "./predicate";
import { Window } from "./window";
import { Funnel, FunnelStep, MAX_FUNNEL_STEPS, type FunnelError } from "./funnel";

const week = Window.lastDays(7);
const hour = Duration.hours(1);

const steps = (...names: string[]) => names.map((n) => FunnelStep.of([n]));
const signup = () => Funnel.of(steps("page_view", "sign_up"), week, hour);

const valid = (f: Funnel) => {
  const r = Funnel.validate(f);
  if (!r.ok) throw new Error(`expected valid, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const invalid = (f: Funnel): FunnelError => {
  const r = Funnel.validate(f);
  if (r.ok) throw new Error("expected invalid, got ok");
  return r.error;
};

describe("a funnel is ordered and time-bounded by construction", () => {
  test("it carries a conversion window — without one it is only set membership", () => {
    const f = signup();
    expect(Duration.toMillis(f.conversionWindow)).toBe(3_600_000);
    valid(f);
  });

  test("a non-positive conversion window is refused", () => {
    expect(invalid(Funnel.of(steps("a", "b"), week, Duration.ZERO)).kind).toBe(
      "NonPositiveConversionWindow",
    );
    expect(
      invalid(Funnel.of(steps("a", "b"), week, Duration.minutes(-5))).kind,
    ).toBe("NonPositiveConversionWindow");
  });

  test("fewer than two steps is not a funnel", () => {
    expect(invalid(Funnel.of(steps("a"), week, hour))).toEqual({ kind: "TooFewSteps", count: 1 });
    expect(invalid(Funnel.of([], week, hour))).toEqual({ kind: "TooFewSteps", count: 0 });
  });

  test("step count is capped", () => {
    const many = steps(...Array.from({ length: MAX_FUNNEL_STEPS + 1 }, (_, i) => `e${i}`));
    expect(invalid(Funnel.of(many, week, hour))).toMatchObject({ kind: "TooManySteps", max: MAX_FUNNEL_STEPS });
    valid(Funnel.of(steps(...Array.from({ length: MAX_FUNNEL_STEPS }, (_, i) => `e${i}`)), week, hour));
  });

  test("a step must name at least one event", () => {
    expect(invalid(Funnel.of([FunnelStep.of([]), FunnelStep.of(["b"])], week, hour))).toEqual({
      kind: "StepWithoutEvents",
      index: 0,
    });
  });

  test("blank event names are refused, with the offending index", () => {
    expect(invalid(Funnel.of([FunnelStep.of(["a"]), FunnelStep.of([" "])], week, hour))).toEqual({
      kind: "EmptyEventName",
      index: 1,
    });
  });
});

describe("steps carry predicates — v1 discarded them", () => {
  test("a step can be narrowed by a property filter", () => {
    const f = Funnel.of(
      [
        FunnelStep.of(["page_view"]),
        FunnelStep.of(["purchase"], Predicate.gt(FieldRef.property("amount"), 100), "Big purchase"),
      ],
      week,
      Duration.days(1),
    );
    valid(f);
    expect(f.steps[1]!.where).toBeDefined();
    expect(Funnel.labels(f)).toEqual(["page_view", "Big purchase"]);
  });

  test("a step can be reached by any of several events", () => {
    const f = Funnel.of(
      [FunnelStep.of(["page_view"]), FunnelStep.of(["sign_up", "sign_up_oauth"])],
      week,
      hour,
    );
    valid(f);
    expect(Funnel.labels(f)[1]).toBe("sign_up or sign_up_oauth");
    expect(Funnel.eventNames(f)).toEqual(["page_view", "sign_up", "sign_up_oauth"]);
  });

  test("event names are deduplicated across steps", () => {
    const f = Funnel.of(steps("view", "view", "buy"), week, hour);
    expect(Funnel.eventNames(f)).toEqual(["view", "buy"]);
  });
});

describe("basis", () => {
  test("visit-scoped is the default and does not span visits", () => {
    const f = signup();
    expect(f.basis).toBe("visit");
    expect(Funnel.spansVisits(f)).toBe(false);
    expect(Funnel.basisLabel(f)).toBe("visits");
  });

  test("person-scoped spans visits", () => {
    const f = Funnel.of(steps("a", "b"), week, Duration.days(7), "person");
    expect(Funnel.spansVisits(f)).toBe(true);
    expect(Funnel.basisLabel(f)).toBe("people");
  });
});

describe("summarize", () => {
  const f = Funnel.of(steps("page_view", "sign_up", "purchase"), week, Duration.days(1));

  const summarize = (counts: readonly number[]) => {
    const r = Funnel.summarize(f, counts);
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
    return r.value;
  };

  test("step 0 is always 100%, later steps are relative to the previous", () => {
    const r = summarize([1000, 400, 100]);
    expect(r.steps.map((s) => s.reached)).toEqual([1000, 400, 100]);
    expect(r.steps[0]!.rate).toBe(100);
    expect(r.steps[1]!.rate).toBeCloseTo(40, 6);
    expect(r.steps[2]!.rate).toBeCloseTo(25, 6);
  });

  test("cumulative rate is relative to the first step", () => {
    const r = summarize([1000, 400, 100]);
    expect(r.steps.map((s) => s.cumulativeRate)).toEqual([100, 40, 10]);
    expect(r.overallRate).toBeCloseTo(10, 6);
  });

  test("drop-off counts the subjects lost at each step", () => {
    const r = summarize([1000, 400, 100]);
    expect(r.steps.map((s) => s.droppedOff)).toEqual([0, 600, 300]);
    expect(Funnel.biggestDropOff(r)?.droppedOff).toBe(600);
  });

  test("an empty first step gives zeros, not NaN", () => {
    // v1 divided without guarding, so this rendered as "NaN%".
    const r = summarize([0, 0, 0]);
    expect(r.steps.map((s) => s.rate)).toEqual([100, 0, 0]);
    expect(r.overallRate).toBe(0);
    expect(r.steps.every((s) => Number.isFinite(s.rate))).toBe(true);
    expect(Funnel.biggestDropOff(r)).toBeNull();
  });

  test("a perfect funnel loses nobody", () => {
    const r = summarize([50, 50, 50]);
    expect(r.overallRate).toBe(100);
    expect(Funnel.biggestDropOff(r)).toBeNull();
  });

  test("counts must match the step count", () => {
    const r = Funnel.summarize(f, [10, 5]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("CountMismatch");
  });

  test("a rising count is rejected rather than reported as over 100%", () => {
    // Each step is a subset of the previous one, so this means the store
    // answered a different question than the one asked. v1 could not detect
    // it: monotonicity there was an accident of the conjunctive query.
    const r = Funnel.summarize(f, [100, 150, 10]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("NonMonotonicCounts");
      expect(r.error.detail).toContain("step 1");
    }
  });

  test("equal adjacent counts are fine", () => {
    expect(Funnel.summarize(f, [100, 100, 40]).ok).toBe(true);
  });

  test("labels come through to the result", () => {
    const labelled = Funnel.of(
      [FunnelStep.of(["page_view"], undefined, "Landed"), FunnelStep.of(["sign_up"], undefined, "Signed up")],
      week,
      hour,
    );
    const r = Funnel.summarize(labelled, [10, 3]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.steps.map((s) => s.label)).toEqual(["Landed", "Signed up"]);
  });

  test("rates keep full precision; rounding is presentation's job", () => {
    const r = summarize([3, 1, 1]);
    expect(r.steps[1]!.rate).toBeCloseTo(33.333333, 4);
  });
});
