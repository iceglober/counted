#!/usr/bin/env bun
/**
 * Create the Counted Pro product + monthly/annual prices in Stripe.
 *
 * Operates in whatever mode the key implies: a `sk_test_…` key sets up your
 * sandbox, a `sk_live_…` key sets up production. Idempotent — re-running finds
 * the existing product/prices (by name + price lookup_keys) instead of
 * duplicating. Prints the two price IDs to paste into your env.
 *
 * Run:
 *   STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-setup.ts
 *
 * Then set in Railway (+ local .env):
 *   STRIPE_PRICE_MONTHLY_ID, STRIPE_PRICE_ANNUAL_ID
 */
export {};

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (use your sk_test_… key for the sandbox).");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
const mode = key.startsWith("sk_test_") ? "TEST (sandbox)" : "LIVE";

const PRODUCT_NAME = "Counted Pro";
const MONTHLY = { lookup: "counted_pro_monthly", amount: 1200, interval: "month" as const, nickname: "Pro Monthly" };
const ANNUAL = { lookup: "counted_pro_annual", amount: 12000, interval: "year" as const, nickname: "Pro Annual" };

async function findPrice(lookupKey: string): Promise<Stripe.Price | null> {
  const res = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return res.data[0] ?? null;
}

async function ensureProduct(): Promise<Stripe.Product> {
  const res = await stripe.products.list({ active: true, limit: 100 });
  const existing = res.data.find((p) => p.metadata?.app === "counted" && p.name === PRODUCT_NAME);
  if (existing) return existing;
  return stripe.products.create({
    name: PRODUCT_NAME,
    description: "1M events/month, unlimited projects, 24-month retention, API access.",
    metadata: { app: "counted" },
  });
}

async function ensurePrice(
  product: Stripe.Product,
  cfg: { lookup: string; amount: number; interval: "month" | "year"; nickname: string },
): Promise<Stripe.Price> {
  return (
    (await findPrice(cfg.lookup)) ??
    (await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: cfg.amount,
      recurring: { interval: cfg.interval },
      lookup_key: cfg.lookup,
      nickname: cfg.nickname,
    }))
  );
}

const WEBHOOK_URL = "https://app.counted.dev/api/billing/webhook";
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

// Stripe only returns the signing secret when the endpoint is first created, so
// this is create-once: if the endpoint already exists, reuse your existing
// STRIPE_WEBHOOK_SECRET (or delete it in the dashboard and re-run).
async function ensureWebhook(): Promise<{ secret: string | null; id: string }> {
  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = existing.data.find((e) => e.url === WEBHOOK_URL);
  if (found) return { secret: null, id: found.id };
  const ep = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: WEBHOOK_EVENTS });
  return { secret: ep.secret ?? null, id: ep.id };
}

const product = await ensureProduct();
const monthly = await ensurePrice(product, MONTHLY);
const annual = await ensurePrice(product, ANNUAL);
const webhook = await ensureWebhook();

console.log(`\nStripe mode: ${mode}`);
console.log(`Product: ${product.name} (${product.id})`);
console.log(`Webhook: ${WEBHOOK_URL} (${webhook.id})`);
console.log(`\nSet these in your env (Railway + local .env):\n`);
console.log(`STRIPE_PRICE_MONTHLY_ID=${monthly.id}`);
console.log(`STRIPE_PRICE_ANNUAL_ID=${annual.id}`);
if (webhook.secret) {
  console.log(`STRIPE_WEBHOOK_SECRET=${webhook.secret}`);
} else {
  console.log(`# STRIPE_WEBHOOK_SECRET — endpoint already existed; reuse your saved secret,`);
  console.log(`#   or delete the endpoint in the Stripe dashboard and re-run to mint a new one.`);
}
