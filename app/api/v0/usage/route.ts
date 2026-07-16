import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { getUsageForOwner } from "@/lib/usage";

// Returns the signed-in user's current monthly usage against their plan limit.
// The settings usage bar renders from this. Shape: { used, limit, plan }.
export async function GET() {
  const { session, error, status } = await requireSession();
  if (error) {
    return NextResponse.json({ error }, { status });
  }

  const usage = await getUsageForOwner(session!.user.id);
  return NextResponse.json(usage);
}
