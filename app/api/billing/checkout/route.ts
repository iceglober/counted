import { NextRequest, NextResponse } from "next/server";
import { getStripe, PLANS } from "@/lib/stripe";
import { requireSession } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logError } from "@/lib/log";

export async function POST(request: NextRequest) {
  const { session, error, status } = await requireSession();
  if (error) return NextResponse.json({ error }, { status });

  try {
    const { interval = "monthly" } = await request.json().catch(() => ({}));
    const priceId = interval === "annual" ? PLANS.pro.stripePriceAnnual : PLANS.pro.stripePriceMonthly;
    if (!priceId) {
      return NextResponse.json({ error: "Billing is not configured (missing price id)." }, { status: 500 });
    }

    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, session!.user.id),
    });

    let customerId: string;
    if (sub?.stripeCustomerId) {
      customerId = sub.stripeCustomerId;
    } else {
      const customer = await getStripe().customers.create({
        email: session!.user.email,
        metadata: { userId: session!.user.id },
      });
      customerId = customer.id;

      await db
        .insert(subscriptions)
        .values({
          id: `sub_${Date.now()}`,
          userId: session!.user.id,
          stripeCustomerId: customerId,
          plan: "free",
          status: "active",
        })
        .onConflictDoNothing();
    }

    const checkoutSession = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.BETTER_AUTH_URL}/dashboards?upgraded=true`,
      cancel_url: `${process.env.BETTER_AUTH_URL}/pricing`,
      metadata: { userId: session!.user.id },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (e) {
    // Log the real Stripe/DB error for debugging, but return a generic message
    // to the client — raw provider errors shouldn't leak to end users.
    logError("billing_checkout", e);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
