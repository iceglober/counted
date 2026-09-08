import { describe, expect, test } from "bun:test";
import { PlanCatalog } from "@counted/tenancy-domain";
import { isPaidPlan, planForPrice, priceFor, type PlanPrices } from "./plans";

const PRICES: PlanPrices = {
  pro: { monthly: "price_pro_monthly", annual: "price_pro_annual" },
};

describe("priceFor", () => {
  test("names a price per plan per cadence", () => {
    expect(priceFor(PRICES, "pro", "monthly")).toBe("price_pro_monthly");
    expect(priceFor(PRICES, "pro", "annual")).toBe("price_pro_annual");
  });

  test("the free plan has no price, and that is a null rather than a throw", () => {
    expect(priceFor(PRICES, "free", "monthly")).toBeNull();
  });
});

describe("planForPrice", () => {
  test("maps a price back to its plan whichever cadence it is", () => {
    expect(planForPrice(PRICES, "price_pro_monthly")).toBe("pro");
    expect(planForPrice(PRICES, "price_pro_annual")).toBe("pro");
  });

  test("an unrecognised price is null, never a guess", () => {
    // A legacy price, a plan created in the Stripe dashboard, a coupon-bound
    // variant. Guessing here hands out entitlements nobody bought.
    expect(planForPrice(PRICES, "price_from_2019")).toBeNull();
  });
});

describe("the paid-plan set", () => {
  test("is the catalog's, not a second list", () => {
    // v1 kept PLANS inside lib/stripe.ts, so the vendor decided what a customer
    // was allowed to do. `PlanPrices` is keyed by Exclude<PlanId, "free">, so
    // adding a paid tier to the domain makes the composition root stop
    // compiling until it has a price id.
    const paid = PlanCatalog.all()
      .filter((plan) => PlanCatalog.isPaid(plan.id))
      .map((plan) => plan.id);
    expect(Object.keys(PRICES).sort()).toEqual([...paid].sort());
    expect(paid.every(isPaidPlan)).toBe(true);
  });
});
