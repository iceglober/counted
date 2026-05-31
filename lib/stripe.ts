import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return _stripe;
}

export const PLANS = {
  free: {
    name: "Free",
    events: 100_000,
    projects: 3,
    price: 0,
  },
  pro: {
    name: "Pro",
    events: 1_000_000,
    projects: -1,
    priceMonthly: 12,
    priceAnnual: 120,
    get stripePriceMonthly() { return process.env.STRIPE_PRICE_MONTHLY_ID!; },
    get stripePriceAnnual() { return process.env.STRIPE_PRICE_ANNUAL_ID!; },
  },
} as const;
