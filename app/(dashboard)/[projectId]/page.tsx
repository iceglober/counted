import { DashboardView } from "@/components/dashboard/dashboard-view";

export default async function ProjectDashboard({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await params;
  return <DashboardView />;
}
