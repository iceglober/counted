import { describe, expect, test } from "bun:test";
import { Instant } from "../shared";
import { Window } from "./window";
import { resolveWindow } from "./time-axis";
import { SUMMARY_STATS, SummaryStat, Trend, previousWindow } from "./trend";

const iso = (s: string) => Instant.fromEpochMillis(Date.parse(s));
const show = (i: Instant) => Instant.toISO(i);

const bounds = (w: Window, now: Instant) => {
  const { from, to } = resolveWindow(w, now);
  return [show(from), show(to)];
};

describe("previousWindow", () => {
  test("a 7-day window is preceded by the 7 days before it", () => {
    const now = iso("2026-03-17T12:00:00Z");
    const prev = previousWindow(Window.lastDays(7), now);
    expect(bounds(prev, now)).toEqual([
      "2026-03-03T12:00:00.000Z",
      "2026-03-10T12:00:00.000Z",
    ]);
  });

  test("months are real months, not 30 days — the v1 trend bug", () => {
    // v1 subtracted a flat 30-day span, so "the month before last month"
    // drifted by up to three days and every month-over-month figure was off.
    const now = iso("2026-03-15T00:00:00Z");
    const prev = previousWindow(Window.lastMonths(1), now);
    expect(bounds(prev, now)).toEqual([
      "2026-01-15T00:00:00.000Z",
      "2026-02-15T00:00:00.000Z",
    ]);
  });

  test("a month step across February stays on the calendar", () => {
    const now = iso("2026-03-31T00:00:00Z");
    // Current window starts 2026-02-28 (clamped). The previous one steps back
    // another calendar month from there.
    const prev = previousWindow(Window.lastMonths(1), now);
    expect(bounds(prev, now)[1]).toBe("2026-02-28T00:00:00.000Z");
    expect(bounds(prev, now)[0]).toBe("2026-01-28T00:00:00.000Z");
  });

  test("the previous window ends exactly where the current one begins", () => {
    const now = iso("2026-03-17T12:00:00Z");
    for (const w of [
      Window.lastHours(6),
      Window.lastDays(30),
      Window.lastWeeks(2),
      Window.lastMonths(3),
    ]) {
      const current = resolveWindow(w, now);
      const prev = previousWindow(w, now);
      expect(show(resolveWindow(prev, now).to)).toBe(show(current.from));
    }
  });

  test("an absolute window mirrors its own span backwards", () => {
    const now = iso("2026-06-01T00:00:00Z");
    const w = Window.between(iso("2026-03-01T00:00:00Z"), iso("2026-03-11T00:00:00Z"));
    const prev = previousWindow(w, now);
    expect(bounds(prev, now)).toEqual([
      "2026-02-19T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });

  test("the result is absolute, so a previous period does not drift with the clock", () => {
    const prev = previousWindow(Window.lastDays(7), iso("2026-03-17T12:00:00Z"));
    expect(prev.kind).toBe("absolute");
    // Resolving it against a later "now" gives the same bounds.
    expect(bounds(prev, iso("2026-03-17T12:00:00Z"))).toEqual(
      bounds(prev, iso("2026-09-01T00:00:00Z")),
    );
  });
});

describe("Trend", () => {
  test("reports the movement in absolute and relative terms", () => {
    const t = Trend.between(150, 100);
    expect(t.absoluteChange).toBe(50);
    expect(t.percentChange).toBeCloseTo(50, 6);
    expect(t.direction).toBe("up");
  });

  test("a fall is negative in both", () => {
    const t = Trend.between(75, 100);
    expect(t.absoluteChange).toBe(-25);
    expect(t.percentChange).toBeCloseTo(-25, 6);
    expect(t.direction).toBe("down");
  });

  test("no movement is flat, not up", () => {
    const t = Trend.between(100, 100);
    expect(t.direction).toBe("flat");
    expect(t.percentChange).toBe(0);
  });

  test("growth from nothing has no percentage, rather than a fake zero", () => {
    // v1 returned 0 here and rendered "+0%" beside a number that had gone from
    // nothing to something.
    const t = Trend.between(100, 0);
    expect(t.percentChange).toBeNull();
    expect(t.absoluteChange).toBe(100);
    expect(t.direction).toBe("up");
    expect(Trend.isComparable(t)).toBe(false);
  });

  test("nothing to nothing is flat and incomparable", () => {
    const t = Trend.between(0, 0);
    expect(t.direction).toBe("flat");
    expect(t.percentChange).toBeNull();
  });

  test("everything stays a number — no strings anywhere", () => {
    const t = Trend.between(1_234_567, 1_000_000);
    // v1 formatted with toLocaleString in the query layer, then recovered the
    // number with parseFloat(value.replace(/,/g, "")).
    expect(typeof t.current).toBe("number");
    expect(typeof t.absoluteChange).toBe("number");
    expect(t.current).toBe(1_234_567);
  });

  test("direction alone does not say whether the news is good", () => {
    const slower = Trend.between(900, 600); // page load time went up
    expect(Trend.isFavourable(slower, false)).toBe(false);
    expect(Trend.isFavourable(slower, true)).toBe(true);

    const fewerErrors = Trend.between(2, 10);
    expect(Trend.isFavourable(fewerErrors, false)).toBe(true);

    expect(Trend.isFavourable(Trend.between(5, 5), true)).toBe(false);
  });
});

describe("SummaryStat", () => {
  const series = [10, 40, 25, 5, 20];

  test("collapses a series the five documented ways", () => {
    expect(SummaryStat.apply("total", series)).toBe(100);
    expect(SummaryStat.apply("average", series)).toBe(20);
    expect(SummaryStat.apply("peak", series)).toBe(40);
    expect(SummaryStat.apply("low", series)).toBe(5);
    expect(SummaryStat.apply("latest", series)).toBe(20);
  });

  test("an empty series is zero everywhere, not NaN or undefined", () => {
    for (const stat of SUMMARY_STATS) {
      const value = SummaryStat.apply(stat, []);
      expect(value).toBe(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("a single-point series is its own everything", () => {
    for (const stat of SUMMARY_STATS) expect(SummaryStat.apply(stat, [7])).toBe(7);
  });

  test("negatives are handled by peak and low", () => {
    expect(SummaryStat.apply("peak", [-5, -1, -9])).toBe(-1);
    expect(SummaryStat.apply("low", [-5, -1, -9])).toBe(-9);
  });

  test("averages keep full precision; rounding is presentation's job", () => {
    expect(SummaryStat.apply("average", [1, 2])).toBe(1.5);
    expect(SummaryStat.apply("average", [1, 1, 2])).toBeCloseTo(1.333333, 5);
  });

  test("only the average needs a per-bucket unit to read sensibly", () => {
    expect(SummaryStat.isPerBucket("average")).toBe(true);
    expect(SummaryStat.isPerBucket("total")).toBe(false);
    expect(SummaryStat.isPerBucket("peak")).toBe(false);
  });

  test("every stat has a label", () => {
    for (const stat of SUMMARY_STATS) expect(SummaryStat.label(stat).length).toBeGreaterThan(0);
  });
});

describe("trend over a real series", () => {
  test("the shape a metric card uses: summarize both windows, then compare", () => {
    const current = [10, 12, 15, 20];
    const previous = [8, 9, 11, 12];

    const t = Trend.between(
      SummaryStat.apply("total", current),
      SummaryStat.apply("total", previous),
    );

    expect(t.current).toBe(57);
    expect(t.previous).toBe(40);
    expect(t.percentChange).toBeCloseTo(42.5, 6);
    expect(t.direction).toBe("up");
  });

  test("comparing peaks works the same way", () => {
    const t = Trend.between(
      SummaryStat.apply("peak", [10, 55, 20]),
      SummaryStat.apply("peak", [10, 50, 20]),
    );
    expect(t.absoluteChange).toBe(5);
    expect(t.percentChange).toBeCloseTo(10, 6);
  });
});
