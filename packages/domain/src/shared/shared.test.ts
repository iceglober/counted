import { describe, expect, test } from "bun:test";
import {
  all,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  partition,
  unwrapOr,
  type Result,
} from "./result";
import { assertNever, brand, unbrand } from "./brand";
import { Duration } from "./duration";
import { type Clock, fixedClock, Instant, scriptedClock } from "./instant";

describe("Result", () => {
  test("ok and err carry their payloads", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err("boom"))).toBe(true);
    const o = ok(1);
    if (o.ok) expect(o.value).toBe(1);
    const e = err("boom");
    if (!e.ok) expect(e.error).toBe("boom");
  });

  test("map transforms Ok and passes Err through", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    const failure: Result<number, string> = err("bad");
    expect(map(failure, (n: number) => n * 3)).toEqual(err("bad"));
  });

  test("mapErr transforms Err and passes Ok through", () => {
    expect(mapErr(err("bad"), (s) => s.length)).toEqual(err(3));
    expect(mapErr(ok(1), () => "unused")).toEqual(ok(1));
  });

  test("flatMap short-circuits on the first Err", () => {
    const half = (n: number): Result<number, string> =>
      n % 2 === 0 ? ok(n / 2) : err("odd");
    expect(flatMap(ok(8), half)).toEqual(ok(4));
    expect(flatMap(ok(7), half)).toEqual(err("odd"));
    const prior: Result<number, string> = err("prior");
    expect(flatMap(prior, half)).toEqual(err("prior"));
  });

  test("all returns the first Err, or every value in order", () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    expect(all([ok(1), err("second"), err("third")])).toEqual(err("second"));
  });

  test("partition keeps both sides — the ingest-batch shape", () => {
    const { values, errors } = partition([ok(1), err("a"), ok(2), err("b")]);
    expect(values).toEqual([1, 2]);
    expect(errors).toEqual(["a", "b"]);
  });

  test("unwrapOr supplies a fallback only for Err", () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err("x") as Result<number, string>, 0)).toBe(0);
  });
});

describe("brand", () => {
  test("round-trips the underlying value", () => {
    const asVisit = brand<"VisitId">();
    const v = asVisit("1720656000.k3j9x2mp");
    expect(unbrand(v)).toBe("1720656000.k3j9x2mp");
  });

  test("assertNever throws when a union grows a variant", () => {
    expect(() => assertNever("unhandled" as never)).toThrow();
  });
});

describe("Duration", () => {
  test("constructors agree in milliseconds", () => {
    expect(Duration.toMillis(Duration.seconds(1))).toBe(1_000);
    expect(Duration.toMillis(Duration.minutes(30))).toBe(1_800_000);
    expect(Duration.toMillis(Duration.hours(1))).toBe(3_600_000);
    expect(Duration.toMillis(Duration.days(1))).toBe(86_400_000);
  });

  test("arithmetic", () => {
    const a = Duration.minutes(30);
    const b = Duration.minutes(15);
    expect(Duration.toMillis(Duration.add(a, b))).toBe(2_700_000);
    expect(Duration.toMillis(Duration.subtract(a, b))).toBe(900_000);
    expect(Duration.toMillis(Duration.multiply(b, 4))).toBe(3_600_000);
  });

  test("comparison and sign", () => {
    expect(Duration.compare(Duration.seconds(1), Duration.seconds(2))).toBeLessThan(0);
    expect(Duration.isZero(Duration.ZERO)).toBe(true);
    expect(Duration.isNegative(Duration.subtract(Duration.seconds(1), Duration.seconds(2)))).toBe(true);
  });

  test("the 30-minute visit timeout is expressible exactly", () => {
    expect(Duration.toMillis(Duration.minutes(30))).toBe(30 * 60 * 1000);
  });
});

describe("Instant", () => {
  const t0 = Instant.fromEpochMillis(1_700_000_000_000);

  test("converts at the boundary without losing precision", () => {
    expect(Instant.toEpochMillis(t0)).toBe(1_700_000_000_000);
    expect(Instant.toEpochMillis(Instant.fromDate(Instant.toDate(t0)))).toBe(1_700_000_000_000);
    expect(Instant.toISO(t0)).toBe("2023-11-14T22:13:20.000Z");
  });

  test("plus and minus move by a Duration", () => {
    expect(Instant.toEpochMillis(Instant.plus(t0, Duration.hours(1)))).toBe(1_700_003_600_000);
    expect(Instant.toEpochMillis(Instant.minus(t0, Duration.hours(1)))).toBe(1_699_996_400_000);
  });

  test("between is signed", () => {
    const later = Instant.plus(t0, Duration.minutes(5));
    expect(Duration.toMillis(Instant.between(t0, later))).toBe(300_000);
    expect(Duration.toMillis(Instant.between(later, t0))).toBe(-300_000);
  });

  test("ordering", () => {
    const later = Instant.plus(t0, Duration.seconds(1));
    expect(Instant.isBefore(t0, later)).toBe(true);
    expect(Instant.isAfter(later, t0)).toBe(true);
    expect(Instant.equals(t0, Instant.fromEpochMillis(1_700_000_000_000))).toBe(true);
    expect(Instant.min(t0, later)).toBe(t0);
    expect(Instant.max(t0, later)).toBe(later);
  });
});

describe("Clock", () => {
  test("fixedClock never moves", () => {
    const at = Instant.fromEpochMillis(1_700_000_000_000);
    const clock: Clock = fixedClock(at);
    expect(clock.now()).toBe(at);
    expect(clock.now()).toBe(at);
  });

  test("scriptedClock advances only when told", () => {
    const start = Instant.fromEpochMillis(1_700_000_000_000);
    const clock = scriptedClock(start);
    expect(clock.now()).toBe(start);

    clock.advance(Duration.minutes(31));
    expect(Duration.toMillis(Instant.between(start, clock.now()))).toBe(1_860_000);

    // The shape a visit-rollover test will use: 31 minutes of idle is past the
    // 30-minute timeout, with no sleeping and no global patching.
    expect(
      Duration.compare(Instant.between(start, clock.now()), Duration.minutes(30)),
    ).toBeGreaterThan(0);
  });
});
