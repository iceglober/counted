import { describe, expect, test } from "bun:test";
import { Duration, Instant } from "@counted/kernel";
import {
  ConversionWindow,
  Grain,
  MAX_WINDOW,
  Window,
  previousWindow,
  resolveWindow,
} from "./window";

const at = (iso: string): Instant => {
  const parsed = Instant.fromISO(iso);
  if (!parsed.ok) throw new Error(`bad fixture instant: ${iso}`);
  return parsed.value;
};

describe("three concepts, three types", () => {
  test("a grain, a window and a conversion window are not interchangeable", () => {
    const grain: Grain = "day";
    const window = Window.lastDays(7);
    const conversion = ConversionWindow.of(Duration.days(7));

    // @ts-expect-error a grain is not a window
    const _a: Window = grain;
    // @ts-expect-error a conversion window is not an observation window
    const _b: Window = conversion;
    // @ts-expect-error a duration is not a conversion window
    const _c: ConversionWindow = Duration.days(7);

    expect(ConversionWindow.toMillis(conversion)).toBe(Duration.toMillis(Duration.days(7)));
    expect(Window.isRelative(window)).toBe(true);
  });

  test("the engine's default conversion window is seven days", () => {
    expect(ConversionWindow.toMillis(ConversionWindow.DEFAULT)).toBe(
      Duration.toMillis(Duration.days(7)),
    );
    expect(ConversionWindow.isPositive(ConversionWindow.of(Duration.ZERO))).toBe(false);
  });
});

describe("resolveWindow", () => {
  test("takes `now` as an argument — the domain never reads a clock", () => {
    const now = at("2026-08-30T12:00:00.000Z");
    expect(resolveWindow(Window.lastHours(6), now)).toEqual({
      from: at("2026-08-30T06:00:00.000Z"),
      to: now,
    });
  });

  test("an absolute window resolves to itself", () => {
    const from = at("2026-01-01T00:00:00.000Z");
    const to = at("2026-02-01T00:00:00.000Z");
    expect(resolveWindow(Window.between(from, to), at("2026-08-30T00:00:00.000Z"))).toEqual({
      from,
      to,
    });
  });

  test("a month walks the calendar and clamps, rather than rolling forward", () => {
    // Naive setUTCMonth(-1) on the 31st gives "2026-02-31", which JavaScript
    // rolls to 2026-03-03 — a window that ends three days after it starts.
    const now = at("2026-03-31T12:00:00.000Z");
    expect(resolveWindow(Window.lastMonths(1), now).from).toEqual(
      at("2026-02-28T12:00:00.000Z"),
    );
  });

  test("a month is not 30 days", () => {
    const now = at("2026-03-15T00:00:00.000Z");
    const flat30 = Instant.minus(now, Duration.days(30));
    expect(resolveWindow(Window.lastMonths(1), now).from).not.toEqual(flat30);
    expect(resolveWindow(Window.lastMonths(1), now).from).toEqual(
      at("2026-02-15T00:00:00.000Z"),
    );
  });
});

describe("previousWindow", () => {
  test("is always absolute, so a comparison does not drift under the clock", () => {
    const previous = previousWindow(Window.lastDays(7), at("2026-08-30T00:00:00.000Z"));
    expect(previous.kind).toBe("absolute");
  });

  test("a month-over-month comparison is a real month, not 30 days", () => {
    // v1 subtracted a flat 30-day span here, so every month-over-month figure
    // was off by up to 3.3% forever.
    const previous = previousWindow(Window.lastMonths(1), at("2026-03-31T12:00:00.000Z"));
    expect(previous).toEqual(
      Window.between(at("2026-01-28T12:00:00.000Z"), at("2026-02-28T12:00:00.000Z")),
    );
  });

  test("an absolute window mirrors its own span backwards from its start", () => {
    const from = at("2026-08-10T00:00:00.000Z");
    const to = at("2026-08-20T00:00:00.000Z");
    expect(previousWindow(Window.between(from, to), at("2026-08-30T00:00:00.000Z"))).toEqual(
      Window.between(at("2026-07-31T00:00:00.000Z"), from),
    );
  });
});

describe("sizing", () => {
  test("maximumSpan over-estimates months, so the ceiling refuses eagerly", () => {
    expect(Duration.toMillis(Window.maximumSpan(Window.lastMonths(1)))).toBe(
      Duration.toMillis(Duration.days(31)),
    );
  });

  test("two years is allowed and two years plus a day is not", () => {
    expect(Duration.compare(Window.maximumSpan(Window.lastDays(730)), MAX_WINDOW)).toBe(0);
    expect(Duration.toMillis(Window.maximumSpan(Window.lastDays(731)))).toBeGreaterThan(
      Duration.toMillis(MAX_WINDOW),
    );
  });

  test("the default grain keeps the bucket count readable", () => {
    expect(Window.defaultGrain(Window.lastHours(6))).toBe("hour");
    expect(Window.defaultGrain(Window.lastDays(1))).toBe("hour");
    expect(Window.defaultGrain(Window.lastDays(30))).toBe("day");
    expect(Window.defaultGrain(Window.lastDays(120))).toBe("week");
    expect(Window.defaultGrain(Window.lastMonths(12))).toBe("month");
  });

  test("grains order coarsest last", () => {
    expect(Grain.isCoarserThan("month", "week")).toBe(true);
    expect(Grain.isCoarserThan("hour", "day")).toBe(false);
  });
});

describe("identity", () => {
  test("two spellings of the same window share a key", () => {
    expect(Window.toKey(Window.lastDays(7))).toBe(Window.toKey({ kind: "relative", unit: "day", amount: 7 }));
  });

  test("a relative and an absolute window never share a key", () => {
    const now = at("2026-08-30T00:00:00.000Z");
    const resolved = resolveWindow(Window.lastDays(7), now);
    expect(Window.toKey(Window.lastDays(7))).not.toBe(
      Window.toKey(Window.between(resolved.from, resolved.to)),
    );
  });
});
