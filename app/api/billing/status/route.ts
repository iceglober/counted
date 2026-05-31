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

  return NextResponse.json({
    plan: sub?.plan ?? "free",
    status: sub?.status ?? "active",
    currentPeriodEnd: sub?.currentPeriodEnd,
  });
}
