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

type Fail = { kind: "Fail"; at: number };

describe("Result has no zero value", () => {
  test("reading a value requires deciding the Err case first", () => {
    const r: Result<number, Fail> = err({ kind: "Fail", at: 1 });
    // The compiler will not let `r.value` be read without narrowing; the
    // runtime shape backs that up — there is no field to fall back to.
    expect("value" in r).toBe(false);
    expect(isOk(r)).toBe(false);
    expect(isErr(r)).toBe(true);
  });
});

describe("map and mapErr each touch one side", () => {
  test("map transforms Ok and leaves Err alone", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    const e = err<Fail>({ kind: "Fail", at: 1 });
    expect(map(e, (n: number) => n * 3)).toBe(e);
  });

  test("mapErr transforms Err and leaves Ok alone", () => {
    const o = ok(2);
    expect(mapErr(o, () => "other")).toBe(o);
    expect(mapErr(err<Fail>({ kind: "Fail", at: 1 }), (f: Fail) => f.at)).toEqual(err(1));
  });
});

describe("flatMap short-circuits on the first Err", () => {
  test("chains while everything succeeds", () => {
    const step = (n: number): Result<number, Fail> => ok(n + 1);
    expect(flatMap(flatMap(ok(0), step), step)).toEqual(ok(2));
  });

  test("a failing step stops the chain and the later step never runs", () => {
    let ran = 0;
    const boom = (): Result<number, Fail> => err({ kind: "Fail", at: 1 });
    const counted = (n: number): Result<number, Fail> => {
      ran += 1;
      return ok(n);
    };
    expect(flatMap(flatMap(ok(0), boom), counted)).toEqual(err({ kind: "Fail", at: 1 }));
    expect(ran).toBe(0);
  });
});

describe("all vs partition — fail the batch, or keep both halves", () => {
  test("all returns the FIRST error, not a merged one", () => {
    const results: Result<number, Fail>[] = [
      ok(1),
      err({ kind: "Fail", at: 2 }),
      err({ kind: "Fail", at: 3 }),
    ];
    expect(all(results)).toEqual(err({ kind: "Fail", at: 2 }));
  });

  test("all preserves order on success", () => {
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
  });

  test("partition keeps every value and every error — the ingest-batch case", () => {
    const results: Result<number, Fail>[] = [
      ok(1),
      err({ kind: "Fail", at: 2 }),
      ok(3),
      err({ kind: "Fail", at: 4 }),
    ];
    const { values, errors } = partition(results);
    expect(values).toEqual([1, 3]);
    expect(errors).toEqual([
      { kind: "Fail", at: 2 },
      { kind: "Fail", at: 4 },
    ]);
  });

  test("an empty batch is a success carrying nothing, not a failure", () => {
    expect(all<number, Fail>([])).toEqual(ok([]));
  });
});

describe("unwrapOr is the one place a fallback is allowed", () => {
  test("Ok yields its value, Err yields the fallback", () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
    expect(unwrapOr(err<Fail>({ kind: "Fail", at: 1 }), 0)).toBe(0);
  });
});
