import { describe, expect, test } from "bun:test";
import { count, day, durationMs, instant, limit, measured, percentOf } from "./format";

describe("numbers", () => {
  test("counts are grouped in one locale, not the server's", () => {
    // A server-rendered number formatted with the machine's locale renders
    // 1,204 in one region and 1.204 in another for the same data, with no user
    // preference involved anywhere.
    expect(count(1204)).toBe("1,204");
  });

  test("a measured value keeps at most one decimal", () => {
    // 1,204.3719 reports precision the measurement does not have.
    expect(measured(1204.3719)).toBe("1,204.4");
    expect(measured(1204)).toBe("1,204");
  });

  test("null is unlimited and says so, because zero would mean none allowed", () => {
    expect(limit(null)).toBe("unlimited");
    expect(limit(0)).toBe("0");
  });
});

describe("percent of a limit", () => {
  test("there is no percentage of unlimited", () => {
    // A meter rendered at 0% against no limit is a meter that never moves and
    // means nothing.
    expect(percentOf(500, null)).toBeNull();
  });

  test("it stops at 100 even in overage", () => {
    // The bar is full; the pill beside it is what says "past the allowance".
    expect(percentOf(1500, 1000)).toBe(100);
  });
});

describe("instants and durations", () => {
  test("an instant renders in UTC", () => {
    expect(instant("2026-08-30T14:05:09.000Z")).toBe("2026-08-30 14:05");
    expect(day("2026-08-30T14:05:09.000Z")).toBe("2026-08-30");
  });

  test("an unparseable instant is shown as it arrived, never as Invalid Date", () => {
    expect(instant("not-a-date")).toBe("not-a-date");
  });

  test("a duration picks the largest unit that fits and pluralises", () => {
    expect(durationMs(86_400_000)).toBe("1 day");
    expect(durationMs(7 * 86_400_000)).toBe("7 days");
    expect(durationMs(3_600_000)).toBe("1 hour");
    expect(durationMs(500)).toBe("500 ms");
  });
});
