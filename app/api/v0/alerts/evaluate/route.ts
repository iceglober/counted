import { NextRequest, NextResponse } from "next/server";
import { evaluateAlerts } from "@/lib/alert-engine";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await evaluateAlerts();
  return NextResponse.json(result);
}
