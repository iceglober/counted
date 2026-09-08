import { describe, expect, test } from "bun:test";
import { Duration } from "./duration";
import { Instant, isInstant } from "./instant";

const T0 = Instant.fromEpochMillis(1_720_656_000_000); // 2024-07-11T00:00:00Z

describe("Instant round-trips through ISO without drift", () => {
  test("toISO then fromISO is the identity", () => {
    const iso = Instant.toISO(T0);
    expect(iso).toBe("2024-07-11T00:00:00.000Z");
    const back = Instant.fromISO(iso);
    expect(back.ok).toBe(true);
    if (back.ok) expect(Instant.equals(back.value, T0)).toBe(true);
  });

  test("millisecond precision survives", () => {
    const withMillis = Instant.fromEpochMillis(1_720_656_000_123);
    const back = Instant.fromISO(Instant.toISO(withMillis));
    expect(back.ok && Instant.toEpochMillis(back.value)).toBe(1_720_656_000_123);
  });
});

describe("fromISO refuses rather than throwing", () => {
  test.each(["", "not a date", "2024-13-45T00:00:00Z", "275760-09-14T00:00:00Z"])(
    "%p is an Err",
    (raw) => {
      const r = Instant.fromISO(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("NotAnInstant");
    },
  );
});

describe("arithmetic is exact and calendar-free", () => {
  test("plus and minus are inverses", () => {
    const d = Duration.hours(36);
    expect(Instant.equals(Instant.minus(Instant.plus(T0, d), d), T0)).toBe(true);
  });

  test("between is signed", () => {
    const later = Instant.plus(T0, Duration.minutes(90));
    expect(Duration.toMillis(Instant.between(T0, later))).toBe(5_400_000);
    expect(Duration.toMillis(Instant.between(later, T0))).toBe(-5_400_000);
  });

  test("a day is exactly 24 hours, never a calendar day", () => {
    // 2024-03-10 is a US DST transition. Instant arithmetic must not notice.
    const beforeDst = Instant.fromEpochMillis(Date.UTC(2024, 2, 10, 0, 0, 0));
    const after = Instant.plus(beforeDst, Duration.days(1));
    expect(Instant.toEpochMillis(after) - Instant.toEpochMillis(beforeDst)).toBe(86_400_000);
  });
});

describe("comparison", () => {
  const later = Instant.plus(T0, Duration.seconds(1));

  test("orders correctly", () => {
    expect(Instant.isBefore(T0, later)).toBe(true);
    expect(Instant.isAfter(later, T0)).toBe(true);
    expect(Instant.compare(T0, later)).toBeLessThan(0);
  });

  test("min and max pick the right side", () => {
    expect(Instant.equals(Instant.min(T0, later), T0)).toBe(true);
    expect(Instant.equals(Instant.max(T0, later), later)).toBe(true);
  });

  test("an instant is neither before nor after itself", () => {
    expect(Instant.isBefore(T0, T0)).toBe(false);
    expect(Instant.isAfter(T0, T0)).toBe(false);
    expect(Instant.equals(T0, T0)).toBe(true);
  });
});

describe("isInstant guards the range Date can represent", () => {
  test.each([[0], [1_720_656_000_000], [-1_000]])("%p is an instant", (n) => {
    expect(isInstant(n)).toBe(true);
  });

  test.each([[Number.NaN], [Number.POSITIVE_INFINITY], [8.64e15 + 1]])(
    "%p is not",
    (n) => {
      expect(isInstant(n)).toBe(false);
    },
  );

  test("a numeric string is not an instant", () => {
    expect(isInstant("1720656000000")).toBe(false);
  });
});
