import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { loadDashboardById } from "@/lib/dashboard-loader";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { dashboards, projectMembers, projects } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { TimeRange } from "@/lib/types";

export default async function DashboardsRoute({
  searchParams,
}: {
  searchParams: Promise<{ dashboard?: string }>;
}) {
  const { dashboard: dashboardParam } = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const memberships = await db.query.projectMembers.findMany({
    where: eq(projectMembers.userId, session.user.id),
  });
  const projectIds = memberships.map((m) => m.projectId);

  // Dashboards are workspace-level — owned by the user, not a project.
  const allDashboards = await db.query.dashboards.findMany({
    where: eq(dashboards.userId, session.user.id),
  });

  if (allDashboards.length === 0 && projectIds.length === 0) {
    redirect("/projects");
  }

  const timeRange: TimeRange = { type: "relative", value: 30, unit: "days" };

  // Find the active dashboard: by param, or default, or first available
  let activeDashboard = dashboardParam
    ? allDashboards.find((d) => d.id === dashboardParam)
    : allDashboards.find((d) => d.isDefault) ?? allDashboards[0];

  if (!activeDashboard && allDashboards.length > 0) {
    activeDashboard = allDashboards[0];
  }

  let insights: Awaited<ReturnType<typeof loadDashboardById>>["insights"] = [];
  let dashboardId: string | null = null;

  if (activeDashboard) {
    const result = await loadDashboardById(activeDashboard.id, timeRange);
    insights = result.insights;
    dashboardId = activeDashboard.id;
  }

  // The "active project" context (for new insights / the onboarding key): the
  // dashboard's associated project, else a project one of its insights uses,
  // else the user's first project.
  const activeProjectId =
    activeDashboard?.projectId ??
    insights.find((i) => i.projectId)?.projectId ??
    projectIds[0];

  const activeProject = activeProjectId
    ? await db.query.projects.findFirst({ where: eq(projects.id, activeProjectId) })
    : undefined;

  return (
    <DashboardPage
      dashboards={allDashboards.map((d) => ({ id: d.id, name: d.name, isDefault: d.isDefault ?? false }))}
      activeDashboardId={dashboardId}
      activeDashboardName={activeDashboard?.name}
      isDefault={activeDashboard?.isDefault ?? false}
      initialInsights={insights}
      projectId={activeProjectId ?? ""}
      projectKey={activeProject?.clientKey ?? activeProject?.apiKey}
      shareToken={activeDashboard?.shareToken}
      compact={(activeDashboard?.layout as { compact?: boolean } | null)?.compact ?? false}
    />
  );
}
