import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const { session, error, status } = await requireSession();
  if (error) return NextResponse.json({ error }, { status });

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, session!.user.id),
  });

  // Billing is only "enabled" (so the UI can offer Upgrade) when Stripe prices
  // are configured AND live mode is explicitly turned on. Otherwise the client
  // shows the "early access — billing opens soon" copy instead of a button that
  // 500s with "Billing is not configured".
  const billingEnabled =
    process.env.BILLING_LIVE === "true" &&
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_PRICE_MONTHLY_ID;

  return NextResponse.json({
    plan: sub?.plan ?? "free",
    status: sub?.status ?? "active",
    currentPeriodEnd: sub?.currentPeriodEnd,
    billingEnabled,
  });
}
