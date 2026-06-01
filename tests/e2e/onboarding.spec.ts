import { test, expect } from "@playwright/test";

// Journey: a brand-new project with no events lands on the guided onboarding.
// We create the project + an empty dashboard via the API (deterministic setup),
// then drive the real UI: send a test event through the ingestion path, watch
// the flow advance, and open the first-insight configurator.

test("guided onboarding: send first event, then create an insight", async ({ page }) => {
  // Fresh project (zero events) + an empty dashboard so Onboarding renders.
  const projRes = await page.request.post("/api/v0/projects", {
    data: { name: "E2E Onboarding" },
  });
  expect(projRes.ok(), `create project -> ${projRes.status()}`).toBeTruthy();
  const project = await projRes.json();

  const dashRes = await page.request.post("/api/v0/dashboards", {
    data: { projectId: project.id, name: "Empty", slug: "empty", layout: { insights: [] } },
  });
  expect(dashRes.ok(), `create dashboard -> ${dashRes.status()}`).toBeTruthy();
  const dashboard = await dashRes.json();

  await page.goto(`/dashboards?dashboard=${dashboard.id}`);
  await expect(page.getByRole("heading", { name: "Install the SDK" })).toBeVisible();

  // Send a test event — hits the real /api/v0/event ingestion endpoint.
  const [eventResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v0/event") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Send a test event" }).click(),
  ]);
  expect(eventResp.ok(), `event ingest -> ${eventResp.status()}`).toBeTruthy();

  // Flow advances to the "events are flowing" step.
  await expect(page.getByRole("heading", { name: "Events are flowing!" })).toBeVisible();

  // Create the first insight -> the configurator opens (empty grid -> 1 insight).
  await page.getByRole("button", { name: /create your first insight/i }).click();
  await expect(page.getByPlaceholder("Total events")).toBeVisible();
});
