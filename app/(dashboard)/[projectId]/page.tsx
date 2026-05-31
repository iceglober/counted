import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { loadDashboardData } from "@/lib/dashboard-loader";
import { requireProjectAccess } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { dashboards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { TimeRange } from "@/lib/types";

export default async function ProjectDashboardRoute({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ dashboard?: string }>;
}) {
  const { projectId } = await params;
  const { dashboard: dashboardParam } = await searchParams;

  const access = await requireProjectAccess(projectId);
  if (access.error) {
    redirect("/login");
  }

  const allDashboards = await db.query.dashboards.findMany({
    where: eq(dashboards.projectId, projectId),
  });

  const timeRange: TimeRange = { type: "relative", value: 30, unit: "days" };
  const { insights, dashboardId } = await loadDashboardData(projectId, timeRange, dashboardParam);

  const activeDashboard = allDashboards.find((d) => d.id === dashboardId);

  return (
    <DashboardPage
      dashboards={allDashboards.map((d) => ({ id: d.id, name: d.name, isDefault: d.isDefault ?? false }))}
      activeDashboardId={dashboardId}
      activeDashboardName={activeDashboard?.name}
      isDefault={activeDashboard?.isDefault ?? false}
      initialInsights={insights}
      projectId={projectId}
    />
  );
}
