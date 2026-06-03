// Finance dogfood: emit `revenue` events into a Counted "finance" project from
// the Stripe webhook, so Counted measures its own MRR/CAC/burn with Counted.
// Design: internal financial-ops.md.
//
// Safe to deploy before billing is live: a no-op until COUNTED_FINANCE_KEY is
// set. Money is integer cents (never floats). Each event carries the Stripe
// event id (and is keyed on it as the session id) so the finance dashboard can
// dedup Stripe's webhook retries — no separate idempotency table needed.

const FINANCE_KEY = process.env.COUNTED_FINANCE_KEY;
const FINANCE_HOST = process.env.COUNTED_FINANCE_HOST ?? "https://app.counted.dev";

export type RevenueEvent = {
  amountCents: number;
  plan: string;
  interval: "monthly" | "annual" | "unknown";
  isNew: boolean;
  mrrDeltaCents: number;
  stripeEventId: string;
};

// Normalize a charge to monthly-recurring cents (annual / 12), for MRR deltas.
export function monthlyMrrCents(amountCents: number, interval: RevenueEvent["interval"]): number {
  if (interval === "annual") return Math.round(amountCents / 12);
  return amountCents;
}

export async function trackRevenue(e: RevenueEvent): Promise<void> {
  if (!FINANCE_KEY) return; // dogfood off until configured
  try {
    await fetch(`${FINANCE_HOST}/api/v0/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Project-Key": FINANCE_KEY },
      body: JSON.stringify([
        {
          timestamp: new Date().toISOString(),
          sessionId: e.stripeEventId, // deterministic → dashboard can dedup retries
          eventName: "revenue",
          systemProps: { sdkVersion: "finance-dogfood" },
          props: {
            amount_cents: e.amountCents,
            plan: e.plan,
            interval: e.interval,
            is_new: e.isNew,
            mrr_delta_cents: e.mrrDeltaCents,
            stripe_event_id: e.stripeEventId,
          },
        },
      ]),
    });
  } catch (err) {
    // Never let finance instrumentation break the billing webhook.
    const { logError } = await import("./log");
    logError("finance_revenue_emit", err, { stripeEventId: e.stripeEventId });
  }
}
