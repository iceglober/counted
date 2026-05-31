import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-05-27.dahlia",
});

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
    stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY_ID!,
    stripePriceAnnual: process.env.STRIPE_PRICE_ANNUAL_ID!,
  },
} as const;
