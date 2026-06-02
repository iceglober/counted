import { test, expect } from "@playwright/test";

// Dashboards are workspace-level (user-owned), not tied to a single project.
test("deleting a project orphans its dashboards instead of deleting them", async ({ page }) => {
  const proj = await (await page.request.post("/api/v0/projects", { data: { name: "E2E Decouple" } })).json();

  const dash = await (
    await page.request.post("/api/v0/dashboards", {
      data: { projectId: proj.id, slug: `d-${Date.now()}`, template: "blank" },
    })
  ).json();
  expect(dash.userId, "dashboard is user-owned").toBeTruthy();
  expect(dash.projectId).toBe(proj.id);

  const del = await page.request.delete(`/api/v0/projects/${proj.id}`);
  expect(del.ok(), `delete project -> ${del.status()}`).toBeTruthy();

  // The dashboard survives, now orphaned (projectId null), still listed for the user.
  const list = await (await page.request.get("/api/v0/dashboards")).json();
  const found = list.find((d: { id: string }) => d.id === dash.id);
  expect(found, "dashboard should survive project deletion").toBeTruthy();
  expect(found.projectId, "association cleared, dashboard kept").toBeNull();
});

test("a new dashboard is never default; the seeded default stays single", async ({ page }) => {
  const projects = await (await page.request.get("/api/v0/projects")).json();
  const projectId = projects[0].id;

  const created = await (
    await page.request.post("/api/v0/dashboards", {
      data: { projectId, slug: `nd-${Date.now()}`, template: "default" },
    })
  ).json();
  expect(created.isDefault).toBe(false);

  const all = await (await page.request.get("/api/v0/dashboards")).json();
  const defaults = all.filter((d: { isDefault?: boolean }) => d.isDefault);
  expect(defaults.length, "exactly one default per user").toBe(1);
});
