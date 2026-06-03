import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { trackRevenue, monthlyMrrCents } from "@/lib/finance";
import { logError } from "@/lib/log";
import type Stripe from "stripe";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Handlers are idempotent (UPDATE to a target state; revenue events keyed on
  // the Stripe event id), so it's safe for Stripe to retry on a 500.
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        if (!userId || !session.subscription) break;

        const sub = await getStripe().subscriptions.retrieve(session.subscription as string);

        await db
          .update(subscriptions)
          .set({
            stripeSubscriptionId: sub.id,
            stripePriceId: sub.items.data[0]?.price.id,
            plan: "pro",
            status: sub.status,
            currentPeriodEnd: new Date(sub.items.data[0]?.current_period_end * 1000),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const existing = await db.query.subscriptions.findFirst({
          where: eq(subscriptions.stripeCustomerId, customerId),
        });
        if (!existing) break;

        await db
          .update(subscriptions)
          .set({
            status: sub.status,
            plan: sub.status === "active" ? "pro" : "free",
            stripePriceId: sub.items.data[0]?.price.id,
            currentPeriodEnd: new Date(sub.items.data[0]?.current_period_end * 1000),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.stripeCustomerId, customerId));
        break;
      }

      // Canonical revenue event — fires for the first charge AND renewals, so
      // emit finance revenue here (not on checkout) to avoid double-counting.
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const amountCents = invoice.amount_paid ?? 0;
        if (amountCents <= 0) break;

        type LineLike = { price?: { recurring?: { interval?: string } }; plan?: { interval?: string } };
        const line = (invoice.lines?.data?.[0] ?? {}) as unknown as LineLike;
        const raw = line.price?.recurring?.interval ?? line.plan?.interval;
        const interval = raw === "year" ? "annual" : raw === "month" ? "monthly" : "unknown";
        const isNew = invoice.billing_reason === "subscription_create";

        await trackRevenue({
          amountCents,
          plan: "pro",
          interval,
          isNew,
          mrrDeltaCents: isNew ? monthlyMrrCents(amountCents, interval) : 0,
          stripeEventId: event.id,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await db
          .update(subscriptions)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(subscriptions.stripeCustomerId, customerId));
        break;
      }
    }
  } catch (e) {
    logError("billing_webhook", e, { eventType: event.type, eventId: event.id });
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
