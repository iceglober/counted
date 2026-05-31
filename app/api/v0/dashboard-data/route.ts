import { NextRequest, NextResponse } from "next/server";
import { loadDashboardData } from "@/lib/dashboard-loader";
import { requireProjectAccess } from "@/lib/auth-guard";

export async function POST(request: NextRequest) {
  const { projectId, timeRange } = await request.json();

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { insights } = await loadDashboardData(projectId, timeRange);
  return NextResponse.json({ insights });
}
