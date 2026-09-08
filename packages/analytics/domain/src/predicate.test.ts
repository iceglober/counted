import { describe, expect, test } from "bun:test";
import { FieldRef } from "./field";
import { Predicate } from "./predicate";

const locale = FieldRef.dimension("locale");
const os = FieldRef.dimension("os_name");
const plan = FieldRef.property("plan");

describe("field namespaces", () => {
  test("a customer property never collides with one of ours", () => {
    expect(FieldRef.equals(FieldRef.property("locale"), locale)).toBe(false);
    expect(FieldRef.isShadowed(FieldRef.property("locale"))).toBe(true);
    expect(FieldRef.isShadowed(plan)).toBe(false);
  });

  test("parse resolves a bare name in exactly one place", () => {
    expect(FieldRef.parse("locale")).toEqual(locale);
    expect(FieldRef.parse("plan")).toEqual(plan);
  });
});

describe("Predicate.toKey", () => {
  test("is structural, not a serialization of insertion order", () => {
    const built = Predicate.eq(locale, "en-GB");
    const roundTripped = { value: "en-GB", field: locale, op: "eq" } as const;
    expect(Predicate.toKey(built)).toBe(Predicate.toKey(roundTripped));
  });

  test("treats and/or as commutative, so two tiles coalesce", () => {
    const a = Predicate.and(Predicate.eq(locale, "en-GB"), Predicate.eq(os, "iOS"));
    const b = Predicate.and(Predicate.eq(os, "iOS"), Predicate.eq(locale, "en-GB"));
    expect(Predicate.equals(a, b)).toBe(true);
  });

  test("distinguishes a string from a number with the same digits", () => {
    expect(Predicate.toKey(Predicate.eq(plan, "1"))).not.toBe(
      Predicate.toKey(Predicate.eq(plan, 1)),
    );
  });

  test("distinguishes eq from neq on the same field and value", () => {
    expect(Predicate.toKey(Predicate.eq(locale, "en"))).not.toBe(
      Predicate.toKey(Predicate.neq(locale, "en")),
    );
  });
});

describe("structure", () => {
  test("and of one collapses rather than nesting", () => {
    const single = Predicate.eq(locale, "en");
    expect(Predicate.and(single)).toBe(single);
  });

  test("conjuncts flattens nested ands to leaves", () => {
    const p = Predicate.and(
      Predicate.and(Predicate.eq(locale, "en"), Predicate.eq(os, "iOS")),
      Predicate.eq(plan, "pro"),
    );
    expect(Predicate.conjuncts(p).map((c) => c.op)).toEqual(["eq", "eq", "eq"]);
  });

  test("fields walks into every branch", () => {
    const p = Predicate.or(Predicate.not(Predicate.exists(plan)), Predicate.eq(locale, "en"));
    expect(Predicate.fields(p).map(FieldRef.toKey)).toEqual(["prop:plan", "dim:locale"]);
  });

  test("ordering comparisons cannot be expressed against a string", () => {
    // @ts-expect-error gt takes a number; this is the v1 22P02 crash, prevented.
    Predicate.gt(plan, "100");
    expect(Predicate.isNumericComparison(Predicate.gt(plan, 100))).toBe(true);
    expect(Predicate.isNumericComparison(Predicate.eq(plan, 100))).toBe(false);
  });
});
