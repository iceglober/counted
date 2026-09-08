import { describe, expect, test } from "bun:test";
import { Entitlement } from "./entitlement";
import { PlanCatalog } from "./plan";

/**
 * v1 answered "is this customer on Pro?" three ways, so a past-due customer
 * kept unlimited projects while being metered as free. There is one function
 * now; these are the cases the three used to disagree on.
 */
describe("one definition of what a customer gets", () => {
  test("an active paid subscription gets its plan, no grace", () => {
    const e = Entitlement.resolve("pro", "active");
    expect(e.plan).toBe("pro");
    expect(e.limits).toEqual(PlanCatalog.pro.limits);
    expect(e.inGrace).toBe(false);
  });

  test("past due keeps the plan and says so", () => {
    const e = Entitlement.resolve("pro", "past_due");
    expect(e.plan).toBe("pro");
    expect(e.limits.projects).toBeNull();
    expect(e.inGrace).toBe(true);
  });

  test("canceled falls back to free, and is not in grace", () => {
    const e = Entitlement.resolve("pro", "canceled");
    expect(e.plan).toBe("free");
    expect(e.limits).toEqual(PlanCatalog.free.limits);
    expect(e.inGrace).toBe(false);
  });

  test("a plan with no payment is the free entitlement", () => {
    expect(Entitlement.resolve("pro", "none")).toEqual(Entitlement.none());
  });
});

describe("what the workspace enforces", () => {
  test("only the two slot limits reach the aggregate", () => {
    expect(Entitlement.toWorkspaceLimits(Entitlement.resolve("free", "active"))).toEqual({
      maxProjects: 3,
      maxSeats: null,
    });
  });
});

describe("downgrade detection", () => {
  test("pro to free is a downgrade; grace alone is not", () => {
    const pro = Entitlement.resolve("pro", "active");
    const free = Entitlement.resolve("free", "active");
    expect(Entitlement.isDowngrade(pro, free)).toBe(true);
    expect(Entitlement.isDowngrade(free, pro)).toBe(false);
    expect(Entitlement.isDowngrade(pro, Entitlement.resolve("pro", "past_due"))).toBe(false);
  });

  test("equality compares what the customer experiences, not the record", () => {
    expect(Entitlement.equal(Entitlement.resolve("pro", "active"), Entitlement.resolve("pro", "active"))).toBe(true);
    expect(Entitlement.equal(Entitlement.resolve("pro", "active"), Entitlement.resolve("pro", "past_due"))).toBe(false);
  });
});
