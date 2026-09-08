import { describe, expect, test } from "bun:test";
import { Instant } from "@counted/kernel";

import { advance, alignFloor, densify, gridStarts, MAX_BUCKETS, monthSpans } from "./bucketing";

const at = (iso: string): Instant => {
  const parsed = Instant.fromISO(iso);
  if (!parsed.ok) throw new Error(`bad fixture instant: ${iso}`);
  return parsed.value;
};

const iso = (i: Instant): string => Instant.toISO(i);

describe("alignFloor", () => {
  test("a day floors to UTC midnight, not to the machine's midnight", () => {
    expect(iso(alignFloor(at("2024-03-15T10:30:45.123Z"), "day"))).toBe("2024-03-15T00:00:00.000Z");
  });

  test("a week floors to Monday, and Sunday belongs to the week that began six days earlier", () => {
    // 2024-03-17 is a Sunday. Naive `getUTCDay()` arithmetic sends it forward
    // to the 18th, which puts the last day of a week in the next one.
    expect(iso(alignFloor(at("2024-03-17T23:59:59.999Z"), "week"))).toBe("2024-03-11T00:00:00.000Z");
    expect(iso(alignFloor(at("2024-03-11T00:00:00.000Z"), "week"))).toBe("2024-03-11T00:00:00.000Z");
  });

  test("a month floors to the first, whatever the month's length", () => {
    expect(iso(alignFloor(at("2024-02-29T12:00:00.000Z"), "month"))).toBe("2024-02-01T00:00:00.000Z");
  });

  test("flooring is idempotent for every step", () => {
    const sample = at("2024-11-03T07:19:02.500Z");
    for (const step of ["hour", "day", "week", "month"] as const) {
      const once = alignFloor(sample, step);
      expect(iso(alignFloor(once, step))).toBe(iso(once));
    }
  });
});

describe("gridStarts", () => {
  test("is dense and contiguous — every position is exactly one step after the last", () => {
    const starts = gridStarts(at("2024-03-15T10:30:00Z"), at("2024-03-18T00:00:00Z"), "day");
    expect(starts.map(iso)).toEqual([
      "2024-03-15T00:00:00.000Z",
      "2024-03-16T00:00:00.000Z",
      "2024-03-17T00:00:00.000Z",
    ]);
  });

  test("days are 24 hours even across a daylight-saving change", () => {
    // 2024-03-31 is when most of Europe springs forward. Everything here is
    // UTC, so the grid must not notice.
    const starts = gridStarts(at("2024-03-30T00:00:00Z"), at("2024-04-02T00:00:00Z"), "day");
    expect(starts).toHaveLength(3);
    for (let i = 1; i < starts.length; i += 1) {
      const gap = Instant.toEpochMillis(starts[i] as Instant) - Instant.toEpochMillis(starts[i - 1] as Instant);
      expect(gap).toBe(86_400_000);
    }
  });

  test("months step by calendar, so February is shorter than January", () => {
    const starts = gridStarts(at("2024-01-10T00:00:00Z"), at("2024-04-01T00:00:00Z"), "month");
    expect(starts.map(iso)).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2024-02-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    ]);
  });

  test("an absurd window stops at the cap instead of allocating until the process dies", () => {
    // The planner refuses anything over MAX_BUCKETS; this makes sure the grid
    // itself cannot be the thing that hangs while it finds that out.
    const starts = gridStarts(at("1980-01-01T00:00:00Z"), at("2080-01-01T00:00:00Z"), "hour");
    expect(starts.length).toBe(MAX_BUCKETS + 1);
  });
});

describe("advance", () => {
  test("crosses a leap day", () => {
    expect(iso(advance(at("2024-02-01T00:00:00Z"), "month"))).toBe("2024-03-01T00:00:00.000Z");
  });
});

describe("monthSpans", () => {
  test("each span carries its own real length, which is what the query's stride has to be", () => {
    const spans = monthSpans(at("2024-01-15T00:00:00Z"), at("2024-03-10T00:00:00Z"));
    expect(spans.map((s) => s.days)).toEqual([31, 29, 31]);
  });

  test("the first month is whole, not clipped to the requested start", () => {
    // A month bucket is a whole month exactly as an hour bucket is a whole
    // hour. Clipping it would make the first column of a chart mean something
    // the other eleven do not.
    const spans = monthSpans(at("2024-01-15T00:00:00Z"), at("2024-02-20T00:00:00Z"));
    expect(iso(spans[0]?.start as Instant)).toBe("2024-01-01T00:00:00.000Z");
  });

  test("the last month stops at the window, so it never reads past it", () => {
    const spans = monthSpans(at("2024-01-15T00:00:00Z"), at("2024-02-20T00:00:00Z"));
    expect(iso(spans[1]?.to as Instant)).toBe("2024-02-20T00:00:00.000Z");
  });
});

describe("densify", () => {
  test("fills the buckets the engine did not return, because a gap is not a zero", () => {
    const starts = gridStarts(at("2024-03-01T00:00:00Z"), at("2024-03-04T00:00:00Z"), "day");
    const buckets = densify(starts, "day", [{ at: at("2024-03-02T00:00:00Z"), value: 7 }]);
    expect(buckets.map((b) => b.value)).toEqual([0, 7, 0]);
  });

  test("folds daily rows into calendar months — the reason a monthly count is one query", () => {
    const starts = gridStarts(at("2024-01-01T00:00:00Z"), at("2024-03-01T00:00:00Z"), "month");
    const buckets = densify(starts, "month", [
      { at: at("2024-01-05T00:00:00Z"), value: 3 },
      { at: at("2024-01-31T00:00:00Z"), value: 4 },
      { at: at("2024-02-14T00:00:00Z"), value: 10 },
    ]);
    expect(buckets.map((b) => b.value)).toEqual([7, 10]);
  });

  test("a row a millisecond off the grid is floored on, not dropped", () => {
    const starts = gridStarts(at("2024-03-01T00:00:00Z"), at("2024-03-02T00:00:00Z"), "day");
    const buckets = densify(starts, "day", [{ at: at("2024-03-01T00:00:00.001Z"), value: 5 }]);
    expect(buckets.map((b) => b.value)).toEqual([5]);
  });

  test("bucket starts come back in order and match the grid exactly", () => {
    const starts = gridStarts(at("2024-03-01T00:00:00Z"), at("2024-03-04T00:00:00Z"), "day");
    const buckets = densify(starts, "day", []);
    expect(buckets.map((b) => iso(b.start))).toEqual(starts.map(iso));
  });
});
