import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { requireSession } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST() {
  const { session, error, status } = await requireSession();
  if (error) return NextResponse.json({ error }, { status });

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session!.user.id),
  });

  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No billing account" }, { status: 404 });
  }

  const portalSession = await getStripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${process.env.BETTER_AUTH_URL}/dashboard`,
  });

  return NextResponse.json({ url: portalSession.url });
}
