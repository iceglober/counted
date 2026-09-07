import { describe, expect, test } from "bun:test";
import { Duration } from "./duration";

describe("Duration is exact milliseconds", () => {
  test("units convert without rounding", () => {
    expect(Duration.toMillis(Duration.seconds(90))).toBe(90_000);
    expect(Duration.toMillis(Duration.minutes(30))).toBe(1_800_000);
    expect(Duration.toMillis(Duration.hours(2))).toBe(7_200_000);
    expect(Duration.toMillis(Duration.days(1))).toBe(86_400_000);
  });

  test("there is no Duration.months — a month is a boundary, not a length", () => {
    expect("months" in Duration).toBe(false);
  });
});

describe("arithmetic", () => {
  test("add and subtract are inverses", () => {
    const a = Duration.hours(5);
    const b = Duration.minutes(7);
    expect(Duration.toMillis(Duration.subtract(Duration.add(a, b), b))).toBe(
      Duration.toMillis(a),
    );
  });

  test("a negative span is representable and reports itself", () => {
    const d = Duration.subtract(Duration.seconds(1), Duration.seconds(3));
    expect(Duration.isNegative(d)).toBe(true);
    expect(Duration.toSeconds(d)).toBe(-2);
  });

  test("ZERO is zero and says so", () => {
    expect(Duration.isZero(Duration.ZERO)).toBe(true);
    expect(Duration.isZero(Duration.millis(1))).toBe(false);
  });

  test("compare orders by length", () => {
    expect(Duration.compare(Duration.minutes(1), Duration.seconds(61))).toBeLessThan(0);
  });
});
