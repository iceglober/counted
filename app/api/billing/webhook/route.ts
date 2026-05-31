import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId || !session.subscription) break;

      const sub = await stripe.subscriptions.retrieve(session.subscription as string);

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

  return NextResponse.json({ received: true });
}
