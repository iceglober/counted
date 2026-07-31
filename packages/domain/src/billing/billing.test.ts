import { describe, expect, test } from "bun:test";
import { PLAN_IDS, PlanCatalog, type PlanId } from "./plan";
import { Entitlement, type PaymentState } from "./entitlement";
import { OVERAGE_MULTIPLE, Quota } from "./quota";

const PAYMENT_STATES: readonly PaymentState[] = ["none", "active", "past_due", "canceled"];

describe("the catalog lives in the domain", () => {
  test("every plan is answerable without a payment vendor present", () => {
    // v1 kept PLANS inside lib/stripe.ts with lazy env getters for price ids,
    // so the vendor defined what a customer could do.
    for (const id of PLAN_IDS) {
      const plan = PlanCatalog.of(id);
      expect(plan.id).toBe(id);
      expect(plan.name.length).toBeGreaterThan(0);
    }
  });

  test("free is capped, pro is roomier", () => {
    expect(PlanCatalog.free.limits.projects).toBe(3);
    expect(PlanCatalog.pro.limits.projects).toBeNull();
    expect(PlanCatalog.free.limits.eventsPerMonth).toBe(100_000);
    expect(PlanCatalog.pro.limits.eventsPerMonth).toBe(1_000_000);
  });

  test("retention is a plan limit, so the purge job has something to read", () => {
    // Advertised on the pricing page since launch; v1 had no retention column
    // and no purge job, so the claim was simply untrue.
    expect(PlanCatalog.free.limits.retentionDays).toBe(180);
    expect(PlanCatalog.pro.limits.retentionDays).toBe(730);
  });

  test("plans are ordered, so a downgrade is detectable", () => {
    expect(PlanCatalog.isAtLeast("pro", "free")).toBe(true);
    expect(PlanCatalog.isAtLeast("free", "pro")).toBe(false);
    expect(PlanCatalog.isAtLeast("free", "free")).toBe(true);
  });
});

describe("one definition of 'is this customer on Pro?'", () => {
  test("an active subscription grants its plan", () => {
    const e = Entitlement.resolve("pro", "active");
    expect(e.plan).toBe("pro");
    expect(e.inGrace).toBe(false);
    expect(Entitlement.isPaid(e)).toBe(true);
  });

  test("past due keeps the plan and says so, rather than half-honouring it", () => {
    // v1: projects/route.ts read `sub?.plan` alone, so a past-due customer
    // kept unlimited projects; usage.ts required status === "active", so the
    // same customer was metered as free. Two answers, one customer.
    const e = Entitlement.resolve("pro", "past_due");
    expect(e.plan).toBe("pro");
    expect(e.inGrace).toBe(true);
    expect(e.limits.projects).toBeNull();
    expect(e.limits.eventsPerMonth).toBe(1_000_000);
  });

  test("cancelled and absent both mean free", () => {
    for (const state of ["canceled", "none"] as const) {
      const e = Entitlement.resolve("pro", state);
      expect(e.plan).toBe("free");
      expect(e.inGrace).toBe(false);
      expect(Entitlement.isPaid(e)).toBe(false);
    }
  });

  test("limits are always internally consistent — never one plan's projects with another's events", () => {
    for (const plan of PLAN_IDS) {
      for (const payment of PAYMENT_STATES) {
        const e = Entitlement.resolve(plan, payment);
        expect(e.limits).toEqual(PlanCatalog.limitsFor(e.plan));
      }
    }
  });

  test("no subscription at all is the free entitlement", () => {
    expect(Entitlement.none()).toEqual(Entitlement.resolve("free", "none"));
  });

  test("it projects into the limits the Workspace aggregate enforces", () => {
    const limits = Entitlement.toWorkspaceLimits(Entitlement.resolve("free", "active"));
    expect(limits).toEqual({ maxProjects: 3, maxSeats: 1 });

    const pro = Entitlement.toWorkspaceLimits(Entitlement.resolve("pro", "active"));
    expect(pro).toEqual({ maxProjects: null, maxSeats: 10 });
  });

  test("downgrades are detectable", () => {
    const pro = Entitlement.resolve("pro", "active");
    const free = Entitlement.resolve("free", "active");
    expect(Entitlement.isDowngrade(pro, free)).toBe(true);
    expect(Entitlement.isDowngrade(free, pro)).toBe(false);
    expect(Entitlement.isDowngrade(pro, pro)).toBe(false);
  });

  test("cancelling a pro subscription reads as a downgrade", () => {
    const before = Entitlement.resolve("pro", "active");
    const after = Entitlement.resolve("pro", "canceled");
    expect(Entitlement.isDowngrade(before, after)).toBe(true);
  });
});

describe("quota has three outcomes, and they are distinguishable", () => {
  const free = Entitlement.resolve("free", "active");
  const limit = PlanCatalog.free.limits.eventsPerMonth!;

  const decide = (used: number) => Quota.decide(free, { used });

  test("under the allowance is accepted", () => {
    const d = decide(50_000);
    expect(d.kind).toBe("accept");
    expect(Quota.accepts(d)).toBe(true);
    expect(Quota.needsAttention(d)).toBe(false);
  });

  test("just over is overage — still stored, but nameable", () => {
    // v1 had no name for this band. It accepted the events and said nothing.
    const d = decide(limit + 1);
    expect(d.kind).toBe("overage");
    expect(Quota.accepts(d)).toBe(true);
    expect(Quota.needsAttention(d)).toBe(true);
  });

  test("far over is rejected, and rejection is a distinct outcome", () => {
    // v1 returned 202 with the event silently discarded — byte for byte the
    // same response as success. A customer could lose everything and see 202s.
    const d = decide(Math.ceil(limit * OVERAGE_MULTIPLE) + 1);
    expect(d.kind).toBe("reject");
    expect(Quota.accepts(d)).toBe(false);
    expect(Quota.needsAttention(d)).toBe(true);
  });

  test("the band boundaries are exact", () => {
    expect(decide(limit - 1).kind).toBe("accept");
    expect(decide(limit).kind).toBe("overage"); // at the limit, not under it
    expect(decide(limit * OVERAGE_MULTIPLE - 1).kind).toBe("overage");
    expect(decide(limit * OVERAGE_MULTIPLE).kind).toBe("reject");
  });

  test("an unlimited allowance always accepts", () => {
    // Pro has a cap; an unlimited allowance is expressed by the plan, not by
    // the caller. Use a plan whose eventsPerMonth is null to exercise it.
    const unlimitedPlan = { ...Entitlement.resolve("pro", "active") };
    const unlimited = Quota.decide(
      { ...unlimitedPlan, limits: { ...unlimitedPlan.limits, eventsPerMonth: null } },
      { used: 10_000_000 },
    );
    expect(unlimited.kind).toBe("accept");
    expect(Quota.utilisation(unlimited)).toBeNull();
  });

  test("a zero limit rejects rather than dividing by zero", () => {
    const d = Quota.decide({ ...free, limits: { ...free.limits, eventsPerMonth: 0 } }, { used: 1 });
    expect(d.kind).toBe("reject");
    expect(Number.isFinite(Quota.utilisation(d) ?? 0)).toBe(false);
  });

  test("a past-due customer keeps the paid allowance while in grace", () => {
    const grace = Entitlement.resolve("pro", "past_due");
    const d = Quota.decide(grace, { used: 900_000 });
    expect(d.kind).toBe("accept");
    expect(grace.limits.eventsPerMonth).toBe(1_000_000);
  });

  test("utilisation reads as a fraction of the allowance", () => {
    expect(Quota.utilisation(decide(50_000))).toBeCloseTo(0.5, 6);
    expect(Quota.utilisation(decide(limit))).toBeCloseTo(1, 6);
    expect(Quota.utilisation(decide(limit * 1.2))).toBeCloseTo(1.2, 6);
  });

  test("the decision is pure — same inputs, same answer", () => {
    expect(decide(123_456)).toEqual(decide(123_456));
  });
});

describe("the whole chain, as the ingest path will use it", () => {
  test("payment state to entitlement to quota, with no vendor in sight", () => {
    const cases: readonly [PlanId, PaymentState, number, string][] = [
      ["pro", "active", 900_000, "accept"],
      ["pro", "past_due", 900_000, "accept"],
      ["pro", "canceled", 900_000, "reject"], // dropped to free, far over
      ["free", "none", 50_000, "accept"],
      ["free", "none", 110_000, "overage"],
      ["free", "none", 200_000, "reject"],
    ];

    for (const [plan, payment, used, expected] of cases) {
      const entitlement = Entitlement.resolve(plan, payment);
      const decision = Quota.decide(entitlement, { used });
      expect(decision.kind).toBe(expected as QuotaKind);
    }
  });
});

type QuotaKind = "accept" | "overage" | "reject";
