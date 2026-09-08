import { describe, expect, test } from "bun:test";
import { Entitlement } from "./entitlement";
import { OVERAGE_MULTIPLE, Quota } from "./quota";

const free = Entitlement.resolve("free", "active");
const pro = Entitlement.resolve("pro", "active");

describe("three outcomes, and the caller must handle all three", () => {
  test("under the allowance is ok", () => {
    expect(Quota.decide(free, { used: 99_999 }).kind).toBe("ok");
  });

  test("at the allowance is already overage — the hundred-thousandth event is the one over", () => {
    const d = Quota.decide(free, { used: 100_000 });
    expect(d.kind).toBe("overage");
    expect(Quota.accepts(d)).toBe(true);
    expect(Quota.needsAttention(d)).toBe(true);
  });

  test("past the grace band is rejected, and rejection is visible", () => {
    const d = Quota.decide(free, { used: 130_001 });
    expect(d.kind).toBe("rejected");
    // v1 returned 202 and dropped the event — byte for byte the same response
    // as success. The whole point of naming this state is that a caller cannot
    // treat it as acceptance by accident.
    expect(Quota.accepts(d)).toBe(false);
  });

  test("the band edge is exactly OVERAGE_MULTIPLE", () => {
    expect(Quota.decide(free, { used: 100_000 * OVERAGE_MULTIPLE - 1 }).kind).toBe("overage");
    expect(Quota.decide(free, { used: 100_000 * OVERAGE_MULTIPLE }).kind).toBe("rejected");
  });
});

describe("the vocabulary is the wire's", () => {
  test("ok / overage / rejected, with no translation layer", () => {
    const states = [
      Quota.decide(free, { used: 0 }).kind,
      Quota.decide(free, { used: 100_000 }).kind,
      Quota.decide(free, { used: 1_000_000 }).kind,
    ];
    expect(states).toEqual(["ok", "overage", "rejected"]);
  });
});

describe("an unlimited allowance", () => {
  test("never leaves ok, and reports no utilisation", () => {
    const unlimited = { ...pro, limits: { ...pro.limits, eventsPerMonth: null } };
    const d = Quota.decide(unlimited, { used: 10_000_000 });
    expect(d.kind).toBe("ok");
    expect(Quota.utilisation(d)).toBeNull();
  });
});

describe("a zero allowance", () => {
  test("is past by any amount rather than reporting NaN", () => {
    const nothing = { ...free, limits: { ...free.limits, eventsPerMonth: 0 } };
    const d = Quota.decide(nothing, { used: 1 });
    expect(d.kind).toBe("rejected");
    expect(Quota.utilisation(d)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the allowance has one source", () => {
  test("it comes from the entitlement, and the caller cannot supply one", () => {
    // Pro's allowance is ten times free's, so the same usage decides differently.
    expect(Quota.decide(free, { used: 500_000 }).kind).toBe("rejected");
    expect(Quota.decide(pro, { used: 500_000 }).kind).toBe("ok");
  });
});
