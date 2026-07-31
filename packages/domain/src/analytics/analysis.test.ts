import { describe, expect, test } from "bun:test";
import { Instant } from "../shared";
import { Analysis, Dimension, MAX_LIMIT } from "./analysis";
import { FieldRef, isSystemField } from "./field";
import { Measure } from "./measure";
import { Predicate } from "./predicate";
import { Grain, Window } from "./window";

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const week = Window.lastDays(7);

const valid = (a: Analysis) => {
  const r = Analysis.validate(a);
  if (!r.ok) throw new Error(`expected valid, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const invalid = (a: Analysis) => {
  const r = Analysis.validate(a);
  if (r.ok) throw new Error("expected invalid, got ok");
  return r.error;
};

describe("field namespaces cannot collide", () => {
  test("a customer property named like one of ours stays a property", () => {
    const ours = FieldRef.system("locale");
    const theirs = FieldRef.property("locale");
    expect(FieldRef.equals(ours, theirs)).toBe(false);
    expect(FieldRef.toKey(ours)).toBe("sys:locale");
    expect(FieldRef.toKey(theirs)).toBe("prop:locale");
  });

  test("system fields are a closed set", () => {
    expect(isSystemField("event_name")).toBe(true);
    expect(isSystemField("amount")).toBe(false);
  });
});

describe("measures name their basis", () => {
  test("visits and people are different measures, not aliases", () => {
    expect(Measure.toKey(Measure.distinctVisits())).toBe("distinct:visit");
    expect(Measure.toKey(Measure.distinctPeople())).toBe("distinct:person");
    expect(Measure.label(Measure.distinctVisits())).toBe("Visits");
    expect(Measure.label(Measure.distinctPeople())).toBe("People");
  });

  test("only the person basis requires identified events", () => {
    expect(Measure.requiresPerson(Measure.distinctPeople())).toBe(true);
    expect(Measure.requiresPerson(Measure.distinctVisits())).toBe(false);
    expect(Measure.requiresPerson(Measure.count())).toBe(false);
  });

  test("an analysis inherits that requirement", () => {
    expect(Analysis.requiresPerson({ measure: Measure.distinctPeople(), window: week })).toBe(true);
    expect(Analysis.requiresPerson({ measure: Measure.count(), window: week })).toBe(false);
  });
});

describe("ordering comparisons are numeric at the type level", () => {
  test("gt takes a number, so a guarded cast is safe to emit", () => {
    const p = Predicate.gt(FieldRef.property("amount"), 100);
    expect(Predicate.isNumericComparison(p)).toBe(true);
    // Predicate.gt(FieldRef.property("amount"), "100") does not compile —
    // which is the fix for v1's unguarded ::numeric cast that failed a whole
    // insight whenever one row held a non-numeric value.
  });

  test("equality still accepts any scalar", () => {
    expect(Predicate.isNumericComparison(Predicate.eq(FieldRef.property("plan"), "pro"))).toBe(false);
    expect(Predicate.isNumericComparison(Predicate.eq(FieldRef.property("ok"), true))).toBe(false);
    expect(Predicate.isNumericComparison(Predicate.eq(FieldRef.property("x"), null))).toBe(false);
  });
});

describe("predicate composition", () => {
  test("collects every referenced field, through nesting", () => {
    const p = Predicate.and(
      Predicate.eq(FieldRef.system("os_name"), "macOS"),
      Predicate.or(
        Predicate.gt(FieldRef.property("amount"), 10),
        Predicate.not(Predicate.exists(FieldRef.property("coupon"))),
      ),
    );
    expect(Predicate.fields(p).map(FieldRef.toKey)).toEqual([
      "sys:os_name",
      "prop:amount",
      "prop:coupon",
    ]);
  });

  test("and/or of a single operand collapse", () => {
    const one = Predicate.eq(FieldRef.property("a"), 1);
    expect(Predicate.and(one)).toBe(one);
    expect(Predicate.or(one)).toBe(one);
  });
});

describe("validation", () => {
  test("accepts a well-formed analysis", () => {
    valid({
      measure: Measure.aggregate("sum", "amount"),
      events: ["purchase"],
      where: Predicate.gt(FieldRef.property("amount"), 0),
      groupBy: [Dimension.field(FieldRef.system("country_code"))],
      window: week,
      orderBy: "desc",
      limit: 10,
    });
  });

  test("an aggregate needs a property", () => {
    expect(invalid({ measure: Measure.aggregate("sum", "  "), window: week }).kind).toBe(
      "AggregatePropertyRequired",
    );
  });

  test("blank event names and property keys are refused", () => {
    expect(invalid({ measure: Measure.count(), events: ["ok", " "], window: week }).kind).toBe("EmptyEventName");
    expect(
      invalid({ measure: Measure.count(), where: Predicate.eq(FieldRef.property(""), 1), window: week }).kind,
    ).toBe("EmptyPropertyKey");
    expect(
      invalid({ measure: Measure.count(), groupBy: [Dimension.field(FieldRef.property(""))], window: week }).kind,
    ).toBe("EmptyPropertyKey");
  });

  test("an empty and/or group is a structural error, not an accidental match-everything", () => {
    expect(invalid({ measure: Measure.count(), where: Predicate.and(), window: week })).toEqual({
      kind: "EmptyPredicateGroup",
      op: "and",
    });
  });

  test("an empty IN list is refused", () => {
    expect(
      invalid({ measure: Measure.count(), where: Predicate.in(FieldRef.property("p"), []), window: week }),
    ).toEqual({ kind: "EmptyValueList", op: "in" });
  });

  test("nested predicates are validated too", () => {
    const nested = Predicate.not(Predicate.and(Predicate.or()));
    expect(invalid({ measure: Measure.count(), where: nested, window: week }).kind).toBe("EmptyPredicateGroup");
  });

  test("at most one time dimension", () => {
    const a: Analysis = {
      measure: Measure.count(),
      groupBy: [Dimension.time("day"), Dimension.time("week")],
      window: week,
    };
    expect(invalid(a)).toEqual({ kind: "MultipleTimeDimensions", count: 2 });
  });

  test("limits are bounded", () => {
    expect(invalid({ measure: Measure.count(), window: week, limit: 0 }).kind).toBe("LimitOutOfRange");
    expect(invalid({ measure: Measure.count(), window: week, limit: MAX_LIMIT + 1 }).kind).toBe("LimitOutOfRange");
    valid({ measure: Measure.count(), window: week, limit: MAX_LIMIT });
  });

  test("windows must be positive and forward-running", () => {
    expect(invalid({ measure: Measure.count(), window: Window.lastDays(0) }).kind).toBe("NonPositiveWindow");
    const backwards = Window.between(Instant.fromEpochMillis(2_000), Instant.fromEpochMillis(1_000));
    expect(invalid({ measure: Measure.count(), window: backwards }).kind).toBe("InvertedWindow");
  });
});

describe("windows and grains", () => {
  test("a grain is a boundary size, and month is explicitly nominal", () => {
    expect(Grain.isCoarserThan("month", "day")).toBe(true);
    expect(Grain.isCoarserThan("hour", "day")).toBe(false);
  });

  test("default grain keeps bucket counts readable", () => {
    expect(Window.defaultGrain(Window.lastHours(6))).toBe("hour");
    expect(Window.defaultGrain(Window.lastDays(1))).toBe("hour");
    expect(Window.defaultGrain(Window.lastDays(30))).toBe("day");
    expect(Window.defaultGrain(Window.lastDays(120))).toBe("week");
    expect(Window.defaultGrain(Window.lastMonths(12))).toBe("month");
  });

  test("absolute windows get a grain from their span", () => {
    const day = Window.between(t0, Instant.fromEpochMillis(Instant.toEpochMillis(t0) + 86_400_000));
    expect(Window.defaultGrain(day)).toBe("hour");
  });
});

describe("one definition, reused", () => {
  test("withWindow rebases without duplicating the question", () => {
    const original = Analysis.breakdown(Measure.count(), FieldRef.system("os_name"), week);
    const prior = Analysis.withWindow(original, Window.lastDays(14));

    expect(prior.measure).toBe(original.measure);
    expect(prior.groupBy).toBe(original.groupBy);
    expect(Window.toKey(prior.window)).toBe("rel:14day");
    // The original is untouched.
    expect(Window.toKey(original.window)).toBe("rel:7day");
  });

  test("identical questions share a key, so they can be coalesced", () => {
    const a = Analysis.timeSeries(Measure.count(), week, "day");
    const b = Analysis.timeSeries(Measure.count(), week, "day");
    expect(Analysis.toKey(a)).toBe(Analysis.toKey(b));
  });

  test("event-name order does not change the key", () => {
    const a: Analysis = { measure: Measure.count(), events: ["b", "a"], window: week };
    const b: Analysis = { measure: Measure.count(), events: ["a", "b"], window: week };
    expect(Analysis.toKey(a)).toBe(Analysis.toKey(b));
  });

  test("a different question gets a different key", () => {
    const a = Analysis.timeSeries(Measure.count(), week, "day");
    const b = Analysis.timeSeries(Measure.distinctVisits(), week, "day");
    expect(Analysis.toKey(a)).not.toBe(Analysis.toKey(b));
  });

  test("the same Analysis type serves a monitor and a tile", () => {
    // A monitor's "events in the last hour" and a tile's "events in the last
    // hour" are the same value. v1 had two vocabularies and a regex that
    // silently degraded "1w" to one hour.
    const monitored: Analysis = { measure: Measure.count(), events: ["error"], window: Window.lastHours(1) };
    const tiled: Analysis = { measure: Measure.count(), events: ["error"], window: Window.lastHours(1) };
    expect(Analysis.toKey(monitored)).toBe(Analysis.toKey(tiled));
    valid(monitored);
  });
});

describe("shape helpers", () => {
  test("time and field dimensions are separable", () => {
    const a: Analysis = {
      measure: Measure.count(),
      groupBy: [Dimension.time("day"), Dimension.field(FieldRef.system("os_name"))],
      window: week,
    };
    expect(Analysis.timeDimension(a)).toEqual(Dimension.time("day"));
    expect(Analysis.fieldDimensions(a)).toHaveLength(1);
  });

  test("an analysis with no grouping has neither", () => {
    const a = Analysis.countOverWindow(week);
    expect(Analysis.timeDimension(a)).toBeUndefined();
    expect(Analysis.fieldDimensions(a)).toHaveLength(0);
  });
});
