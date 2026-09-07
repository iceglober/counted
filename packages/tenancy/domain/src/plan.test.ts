import { describe, expect, test } from "bun:test";
import { PLAN_IDS, PlanCatalog, isPlanId } from "./plan";

/**
 * Guard the published allowances, including unlimited membership. The API
 * and console consume this catalog; these assertions cover its values.
 */
describe("the catalog says what the pricing page says", () => {
  test("free: 100K events, 3 projects, 6 months, no seat cap", () => {
    expect(PlanCatalog.free.limits).toEqual({
      eventsPerMonth: 100_000,
      projects: 3,
      seats: null,
      retentionDays: 180,
    });
  });

  test("pro: 1M events, unlimited projects, 24 months, no seat cap", () => {
    expect(PlanCatalog.pro.limits).toEqual({
      eventsPerMonth: 1_000_000,
      projects: null,
      seats: null,
      retentionDays: 730,
    });
  });

  test("no plan meters people — Counted bills on volume", () => {
    for (const id of PLAN_IDS) expect(PlanCatalog.limitsFor(id).seats).toBeNull();
  });
});

describe("a plan id from outside", () => {
  test("an unknown one is refused, not defaulted", () => {
    expect(isPlanId("enterprise")).toBe(false);
    expect(isPlanId("Pro")).toBe(false);
    expect(isPlanId("pro")).toBe(true);
  });
});

describe("generosity ordering", () => {
  test("pro is at least free; free is not at least pro", () => {
    expect(PlanCatalog.isAtLeast("pro", "free")).toBe(true);
    expect(PlanCatalog.isAtLeast("free", "pro")).toBe(false);
    expect(PlanCatalog.isAtLeast("free", "free")).toBe(true);
  });
});
