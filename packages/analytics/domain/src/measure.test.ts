import { describe, expect, test } from "bun:test";
import { CountingBasis, Measure, SummaryStat, Trend } from "./measure";

describe("Measure", () => {
  test("counting people and counting visits are different measures", () => {
    // v1 exposed `unique_users` and compiled it to COUNT(DISTINCT session_id),
    // answering a question about people with a number about visits.
    expect(Measure.toKey(Measure.uniquePeople())).not.toBe(Measure.toKey(Measure.uniqueVisits()));
    expect(Measure.label(Measure.uniquePeople())).toBe("People");
    expect(Measure.label(Measure.uniqueVisits())).toBe("Visits");
  });

  test("only the person basis needs identified events", () => {
    expect(Measure.requiresPerson(Measure.uniquePeople())).toBe(true);
    expect(Measure.requiresPerson(Measure.uniqueVisits())).toBe(false);
    expect(Measure.requiresPerson(Measure.count())).toBe(false);
  });

  test("uniques are recorded as approximate, because HLL sketches are", () => {
    expect(Measure.isApproximate(Measure.uniqueVisits())).toBe(true);
    expect(Measure.isApproximate(Measure.count())).toBe(false);
    expect(Measure.isApproximate(Measure.sum("revenue"))).toBe(false);
  });

  test("only a sum reads a declared measure", () => {
    expect(Measure.readsMeasure(Measure.sum("revenue"))).toBe("revenue");
    expect(Measure.readsMeasure(Measure.count())).toBeNull();
  });

  test("only the person basis spans visits", () => {
    expect(CountingBasis.spansVisits("person")).toBe(true);
    expect(CountingBasis.spansVisits("visit")).toBe(false);
  });
});

describe("SummaryStat on an empty series", () => {
  test("a total is zero, because no events did happen", () => {
    expect(SummaryStat.apply("total", [])).toBe(0);
  });

  test("everything else is null, because there is nothing to report", () => {
    // v2 returned 0 for all five. A monitor watching "latest" against a floor
    // would then have fired on a project that had simply not reported yet.
    expect(SummaryStat.apply("average", [])).toBeNull();
    expect(SummaryStat.apply("peak", [])).toBeNull();
    expect(SummaryStat.apply("low", [])).toBeNull();
    expect(SummaryStat.apply("latest", [])).toBeNull();
  });

  test("a non-empty series collapses as expected", () => {
    const series = [3, 9, 1, 4];
    expect(SummaryStat.apply("total", series)).toBe(17);
    expect(SummaryStat.apply("average", series)).toBe(4.25);
    expect(SummaryStat.apply("peak", series)).toBe(9);
    expect(SummaryStat.apply("low", series)).toBe(1);
    expect(SummaryStat.apply("latest", series)).toBe(4);
  });

  test("a series of zeroes is not an empty series", () => {
    expect(SummaryStat.apply("peak", [0, 0])).toBe(0);
  });
});

describe("Trend", () => {
  test("no baseline means no percentage, not zero percent", () => {
    // v1 rendered "+0%" beside a number that had gone from nothing to something.
    const t = Trend.between(100, 0);
    expect(t.percentChange).toBeNull();
    expect(t.absoluteChange).toBe(100);
    expect(t.direction).toBe("up");
    expect(Trend.isComparable(t)).toBe(false);
  });

  test("a real baseline gives a real percentage", () => {
    expect(Trend.between(150, 100).percentChange).toBe(50);
    expect(Trend.between(50, 100).percentChange).toBe(-50);
    expect(Trend.between(100, 100).direction).toBe("flat");
  });

  test("the caller says which direction is good", () => {
    const down = Trend.between(50, 100);
    expect(Trend.isFavourable(down, true)).toBe(false);
    expect(Trend.isFavourable(down, false)).toBe(true);
    expect(Trend.isFavourable(Trend.between(1, 1), false)).toBe(false);
  });

  test("everything is a number — no formatting leaks into the value", () => {
    const t = Trend.between(1234567, 1000000);
    expect(typeof t.current).toBe("number");
    expect(typeof t.percentChange).toBe("number");
  });
});
