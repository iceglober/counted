import { NextRequest, NextResponse } from "next/server";
import { loadDashboardData, extractInsightLayouts } from "@/lib/dashboard-loader";
import { requireSession, requireProjectAccess, readJson } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { TimeRange } from "@/lib/types";

export async function POST(request: NextRequest) {
  const parsed = await readJson<{ projectId?: string; dashboardId?: string; timeRange?: TimeRange }>(request);
  if (!parsed.ok) return parsed.response;
  const { projectId, dashboardId, timeRange } = parsed.body;

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

    // Resolve the target project strictly from the owned dashboard — never the
    // caller-supplied body projectId, which for a null-projectId dashboard
    // would otherwise flow through loadDashboardData into another tenant's data.
    // Access-check the dashboard's own project plus every non-null project its
    // insights read from before loading anything.
    const resolvedProjectId = dashboard.projectId ?? "";
    const targetProjectIds = new Set<string>();
    if (dashboard.projectId) targetProjectIds.add(dashboard.projectId);
    for (const layout of extractInsightLayouts((dashboard.layout ?? {}) as Record<string, unknown>)) {
      if (layout.projectId) targetProjectIds.add(layout.projectId);
    }
    for (const pid of targetProjectIds) {
      const access = await requireProjectAccess(pid);
      if (access.error) {
        return NextResponse.json({ error: access.error }, { status: access.status });
      }
    }

    const { insights } = await loadDashboardData(resolvedProjectId, timeRange as TimeRange, dashboardId);
    return NextResponse.json({ insights });
  }

  const access = await requireProjectAccess(projectId ?? "", { allowServerKey: true });
  if (access.error) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const { insights } = await loadDashboardData(projectId ?? "", timeRange as TimeRange);
  return NextResponse.json({ insights });
}
