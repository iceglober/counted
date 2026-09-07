import { describe, expect, test } from "bun:test";
import { Duration } from "./duration";
import { Instant } from "./instant";
import { fixedClock, scriptedClock } from "./ports";

const T0 = Instant.fromEpochMillis(1_720_656_000_000);

describe("test clocks make time a value, not global state", () => {
  test("a fixed clock never moves", () => {
    const clock = fixedClock(T0);
    expect(Instant.equals(clock.now(), T0)).toBe(true);
    expect(Instant.equals(clock.now(), T0)).toBe(true);
  });

  test("a scripted clock moves only when told to", () => {
    const clock = scriptedClock(T0);
    expect(Instant.equals(clock.now(), T0)).toBe(true);
    clock.advance(Duration.hours(1));
    expect(Instant.toEpochMillis(clock.now())).toBe(Instant.toEpochMillis(T0) + 3_600_000);
    clock.advance(Duration.minutes(-30));
    expect(Instant.toEpochMillis(clock.now())).toBe(Instant.toEpochMillis(T0) + 1_800_000);
  });
});
