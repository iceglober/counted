import { expect, type APIRequestContext } from "@playwright/test";

// Resolve the seeded primary project's default dashboard by id. Other tests
// create projects/dashboards in the shared DB, so we can't rely on /dashboards
// picking the right active dashboard — navigate to this one explicitly.
export async function seededDashboardId(request: APIRequestContext): Promise<string> {
  const projects = await (await request.get("/api/v0/projects")).json();
  const project =
    projects.find((p: { name: string }) => p.name === "Counted Web") ?? projects[0];
  expect(project, "seed should create the Counted Web project").toBeTruthy();

  const dashboards = await (
    await request.get(`/api/v0/dashboards?projectId=${project.id}`)
  ).json();
  const dashboard =
    dashboards.find((d: { isDefault?: boolean }) => d.isDefault) ?? dashboards[0];
  expect(dashboard, "seeded project should have a dashboard").toBeTruthy();
  return dashboard.id as string;
}
