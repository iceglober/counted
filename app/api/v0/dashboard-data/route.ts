import { NextRequest, NextResponse } from "next/server";
import { loadDashboardData } from "@/lib/dashboard-loader";
import { requireSession, requireProjectAccess } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const { projectId, dashboardId, timeRange } = await request.json();

  // Prefer loading the active dashboard by id (dashboards are user-owned and
  // not tied to a project). Fall back to a project's default dashboard.
  if (dashboardId) {
    const { session, error, status } = await requireSession();
    if (error) return NextResponse.json({ error }, { status });
    const dashboard = await db.query.dashboards.findFirst({ where: eq(dashboards.id, dashboardId) });
    if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (dashboard.userId && dashboard.userId !== session!.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { insights } = await loadDashboardData(dashboard.projectId ?? projectId ?? "", timeRange, dashboardId);
    return NextResponse.json({ insights });
  }

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const { insights } = await loadDashboardData(projectId, timeRange);
  return NextResponse.json({ insights });
}
