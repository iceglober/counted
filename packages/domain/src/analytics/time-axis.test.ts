import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "../shared";
import type { Grain } from "./window";
import { Window } from "./window";
import {
  DEFAULT_WEEK_START,
  MAX_BUCKETS,
  TimeAxis,
  type Weekday,
  resolveWindow,
  step,
  truncTo,
} from "./time-axis";

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));
const show = (i: Instant) => Instant.toISO(i);

/**
 * A deterministic PRNG. The domain forbids Math.random (and every other
 * ambient source), and a seeded generator makes a failure reproducible from
 * the seed alone.
 */
const rng = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  return seed / 0x1_0000_0000;
};

const GRAINS: readonly Grain[] = ["hour", "day", "week", "month"];

describe("truncTo", () => {
  test("hour, day and month land on the obvious boundaries", () => {
    const t = iso("2026-03-17T14:37:52.913Z");
    expect(show(truncTo("hour", t))).toBe("2026-03-17T14:00:00.000Z");
    expect(show(truncTo("day", t))).toBe("2026-03-17T00:00:00.000Z");
    expect(show(truncTo("month", t))).toBe("2026-03-01T00:00:00.000Z");
  });

  test("weeks land on Monday by default", () => {
    // 2026-03-17 is a Tuesday.
    expect(show(truncTo("week", iso("2026-03-17T14:37:52Z")))).toBe("2026-03-16T00:00:00.000Z");
    // A Monday is already its own week start.
    expect(show(truncTo("week", iso("2026-03-16T00:00:00Z")))).toBe("2026-03-16T00:00:00.000Z");
    // Sunday belongs to the week that began the previous Monday.
    expect(show(truncTo("week", iso("2026-03-22T23:59:59Z")))).toBe("2026-03-16T00:00:00.000Z");
  });

  test("week start is a real option, not a coincidence of Timescale's origin", () => {
    const tuesday = iso("2026-03-17T12:00:00Z");
    const sunday: Weekday = 0;
    const saturday: Weekday = 6;
    expect(show(truncTo("week", tuesday, sunday))).toBe("2026-03-15T00:00:00.000Z");
    expect(show(truncTo("week", tuesday, saturday))).toBe("2026-03-14T00:00:00.000Z");
    expect(DEFAULT_WEEK_START).toBe(1);
  });

  test("it is idempotent and never moves forwards", () => {
    const next = rng(7);
    for (let i = 0; i < 400; i++) {
      const t = Instant.fromEpochMillis(Math.floor(next() * 4_102_444_800_000));
      for (const g of GRAINS) {
        const once = truncTo(g, t);
        expect(truncTo(g, once)).toBe(once);
        expect(once <= t).toBe(true);
      }
    }
  });
});

describe("step walks the calendar", () => {
  test("months are months, not 30 days", () => {
    expect(show(step("month", iso("2026-01-01T00:00:00Z")))).toBe("2026-02-01T00:00:00.000Z");
    // February, the case a fixed 30-day span gets wrong every year.
    expect(show(step("month", iso("2026-02-01T00:00:00Z")))).toBe("2026-03-01T00:00:00.000Z");
    // Year boundary.
    expect(show(step("month", iso("2026-12-01T00:00:00Z")))).toBe("2027-01-01T00:00:00.000Z");
  });

  test("leap years are handled by the calendar, not by arithmetic", () => {
    // 2028 is a leap year: February has 29 days.
    const feb = iso("2028-02-01T00:00:00Z");
    const mar = step("month", feb);
    expect(show(mar)).toBe("2028-03-01T00:00:00.000Z");
    expect(Duration.toMillis(Instant.between(feb, mar))).toBe(29 * 86_400_000);

    // 2026 is not.
    const feb26 = iso("2026-02-01T00:00:00Z");
    expect(Duration.toMillis(Instant.between(feb26, step("month", feb26)))).toBe(28 * 86_400_000);
  });

  test("stepping a truncated instant always moves past it", () => {
    const next = rng(11);
    for (let i = 0; i < 300; i++) {
      const t = Instant.fromEpochMillis(Math.floor(next() * 4_102_444_800_000));
      for (const g of GRAINS) {
        const start = truncTo(g, t);
        expect(step(g, start) > start).toBe(true);
        expect(step(g, start) > t || truncTo(g, t) === t).toBe(true);
      }
    }
  });

  test("stepping stays on the boundary it started on", () => {
    for (const g of GRAINS) {
      let cursor = truncTo(g, iso("2026-01-15T09:41:00Z"));
      for (let i = 0; i < 40; i++) {
        expect(truncTo(g, cursor)).toBe(cursor);
        cursor = step(g, cursor);
      }
    }
  });
});

describe("resolveWindow", () => {
  const now = iso("2026-03-17T14:37:00Z");

  test("relative windows subtract calendar units", () => {
    expect(show(resolveWindow(Window.lastDays(7), now).from)).toBe("2026-03-10T14:37:00.000Z");
    expect(show(resolveWindow(Window.lastMonths(1), now).from)).toBe("2026-02-17T14:37:00.000Z");
    expect(show(resolveWindow(Window.lastWeeks(2), now).from)).toBe("2026-03-03T14:37:00.000Z");
  });

  test("a month back from the 31st clamps to the end of the target month", () => {
    // The sharp edge: setUTCMonth alone turns this into "2026-02-31", which JS
    // rolls forward to 2026-03-03 — a "last 1 month" window three days long.
    expect(show(resolveWindow(Window.lastMonths(1), iso("2026-03-31T00:00:00Z")).from))
      .toBe("2026-02-28T00:00:00.000Z");
    // April has 30 days, so the 31st clamps there too.
    expect(show(resolveWindow(Window.lastMonths(1), iso("2026-05-31T00:00:00Z")).from))
      .toBe("2026-04-30T00:00:00.000Z");
    // Leap February gets its 29th.
    expect(show(resolveWindow(Window.lastMonths(1), iso("2028-03-31T00:00:00Z")).from))
      .toBe("2028-02-29T00:00:00.000Z");
    // A day that exists in both months is untouched.
    expect(show(resolveWindow(Window.lastMonths(1), iso("2026-03-15T09:30:00Z")).from))
      .toBe("2026-02-15T09:30:00.000Z");
    // And multi-month steps clamp the same way.
    expect(show(resolveWindow(Window.lastMonths(4), iso("2026-06-30T00:00:00Z")).from))
      .toBe("2026-02-28T00:00:00.000Z");
  });

  test("absolute windows pass through", () => {
    const w = Window.between(iso("2026-01-01T00:00:00Z"), iso("2026-02-01T00:00:00Z"));
    const { from, to } = resolveWindow(w, now);
    expect(show(from)).toBe("2026-01-01T00:00:00.000Z");
    expect(show(to)).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("TimeAxis.build", () => {
  const now = iso("2026-03-17T14:37:00Z");

  test("the leading partial bucket is included, not dropped", () => {
    const axis = TimeAxis.build(Window.lastDays(2), "day", now);
    // Window starts 2026-03-15T14:37; its bucket starts at midnight.
    expect(show(axis.edges[0]!)).toBe("2026-03-15T00:00:00.000Z");
  });

  test("the axis covers the end of the window", () => {
    const axis = TimeAxis.build(Window.lastDays(2), "day", now);
    const last = axis.edges[axis.edges.length - 1]!;
    expect(last > now).toBe(true);
  });

  test("edges are strictly increasing and count is buckets + 1", () => {
    for (const g of GRAINS) {
      const axis = TimeAxis.build(Window.lastDays(40), g, now);
      expect(axis.edges.length).toBe(TimeAxis.bucketCount(axis) + 1);
      for (let i = 1; i < axis.edges.length; i++) {
        expect(axis.edges[i]! > axis.edges[i - 1]!).toBe(true);
      }
    }
  });

  test("month buckets have real, varying lengths", () => {
    const axis = TimeAxis.build(
      Window.between(iso("2026-01-01T00:00:00Z"), iso("2026-05-01T00:00:00Z")),
      "month",
      now,
    );
    const starts = TimeAxis.bucketStarts(axis).map(show);
    expect(starts.slice(0, 4)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
    ]);
    // January is 31 days, February 28 — a fixed-width bucket cannot express this.
    expect(Duration.toMillis(Instant.between(axis.edges[0]!, axis.edges[1]!))).toBe(31 * 86_400_000);
    expect(Duration.toMillis(Instant.between(axis.edges[1]!, axis.edges[2]!))).toBe(28 * 86_400_000);
  });

  test("a pathological window is capped rather than allocating forever", () => {
    const axis = TimeAxis.build(
      Window.between(iso("1990-01-01T00:00:00Z"), iso("2030-01-01T00:00:00Z")),
      "hour",
      now,
    );
    expect(axis.edges.length).toBeLessThanOrEqual(MAX_BUCKETS + 1);
  });
});

describe("TimeAxis.assign", () => {
  const now = iso("2026-03-17T14:37:00Z");
  const axis = TimeAxis.build(Window.lastDays(5), "day", now);

  test("an instant on an edge belongs to the bucket that edge starts", () => {
    const starts = TimeAxis.bucketStarts(axis);
    starts.forEach((s, i) => expect(TimeAxis.assign(axis, s)).toBe(i));
  });

  test("half-open on the right: one millisecond before the next edge is still this bucket", () => {
    const e1 = axis.edges[1]!;
    expect(TimeAxis.assign(axis, Instant.fromEpochMillis(Instant.toEpochMillis(e1) - 1))).toBe(0);
    expect(TimeAxis.assign(axis, e1)).toBe(1);
  });

  test("instants outside the axis assign to nothing", () => {
    const first = axis.edges[0]!;
    const last = axis.edges[axis.edges.length - 1]!;
    expect(TimeAxis.assign(axis, Instant.minus(first, Duration.hours(1)))).toBeNull();
    expect(TimeAxis.assign(axis, last)).toBeNull();
    expect(TimeAxis.assign(axis, Instant.plus(last, Duration.hours(1)))).toBeNull();
  });

  test("every instant inside the axis lands in exactly one bucket, and the edges bracket it", () => {
    const next = rng(23);
    for (const g of GRAINS) {
      const a = TimeAxis.build(Window.lastDays(90), g, now);
      const lo = Instant.toEpochMillis(a.edges[0]!);
      const hi = Instant.toEpochMillis(a.edges[a.edges.length - 1]!);
      for (let i = 0; i < 500; i++) {
        const t = Instant.fromEpochMillis(lo + Math.floor(next() * (hi - lo)));
        const idx = TimeAxis.assign(a, t);
        expect(idx).not.toBeNull();
        const k = idx!;
        expect(a.edges[k]! <= t).toBe(true);
        expect(t < a.edges[k + 1]!).toBe(true);
      }
    }
  });

  test("assignment agrees with truncation — the property the SQL side must also satisfy", () => {
    const next = rng(31);
    for (const g of GRAINS) {
      const a = TimeAxis.build(Window.lastDays(120), g, now);
      const lo = Instant.toEpochMillis(a.edges[0]!);
      const hi = Instant.toEpochMillis(a.edges[a.edges.length - 1]!);
      for (let i = 0; i < 400; i++) {
        const t = Instant.fromEpochMillis(lo + Math.floor(next() * (hi - lo)));
        const idx = TimeAxis.assign(a, t)!;
        // The bucket an instant is assigned to starts exactly where truncating
        // that instant lands. If a compiler ever disagrees, this is the law it
        // broke.
        expect(a.edges[idx]).toBe(truncTo(g, t, a.weekStart));
      }
    }
  });
});

describe("TimeAxis.densify", () => {
  const axis = TimeAxis.build(Window.lastDays(4), "day", iso("2026-03-17T14:37:00Z"));

  test("gaps become zeros without consulting the database's key set", () => {
    const dense = TimeAxis.densify(axis, [
      { index: 0, value: 5 },
      { index: 2, value: 9 },
    ]);
    expect(dense).toHaveLength(TimeAxis.bucketCount(axis));
    expect(dense[0]).toBe(5);
    expect(dense[1]).toBe(0);
    expect(dense[2]).toBe(9);
  });

  test("out-of-range indices are ignored rather than corrupting the series", () => {
    const dense = TimeAxis.densify(axis, [
      { index: -1, value: 99 },
      { index: 9_999, value: 99 },
    ]);
    expect(dense.every((v) => v === 0)).toBe(true);
  });
});

describe("edgeMillis", () => {
  test("edges serialize to the array an adapter binds into width_bucket", () => {
    const axis = TimeAxis.build(Window.lastDays(2), "day", iso("2026-03-17T14:37:00Z"));
    const millis = TimeAxis.edgeMillis(axis);
    expect(millis).toHaveLength(axis.edges.length);
    expect(millis.every((m) => Number.isInteger(m))).toBe(true);
    for (let i = 1; i < millis.length; i++) expect(millis[i]! > millis[i - 1]!).toBe(true);
  });
});
