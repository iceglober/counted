import { test, expect } from "@playwright/test";

// Authenticated journeys as the seeded user test@counted.dev (has projects,
// dashboards, and data). Each page exercises SSR + auth/session + real DB queries
// — the paths that broke in the 2026-06-01 outage.

test("dashboards load with the app shell and an insight", async ({ page }) => {
  await page.goto("/dashboards");
  await expect(page).toHaveURL(/\/dashboards/); // not bounced to /login or /projects
  // App nav present
  await expect(page.getByRole("link", { name: "Dashboards" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Events" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  // The default dashboard renders at least one insight (seeded data).
  await expect(page.locator("canvas, svg, [class*='metric']").first()).toBeVisible();
});

test("projects page lists the seeded project and offers creation", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Counted Web").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /new project/i }).first()).toBeVisible();
});

test("events page renders the live event stream", async ({ page }) => {
  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  // Seeded events should produce known event names in the table.
  await expect(page.getByText(/page_view|button_click|sign_up/).first()).toBeVisible();
});

test("settings page renders general + billing tab", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  // Billing is a tab — switching to it exercises the Stripe-backed billing view.
  await page.getByRole("button", { name: "Billing" }).click();
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
});

test("create a project (mutation hits the API and succeeds)", async ({ page }) => {
  await page.goto("/projects");
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v0/projects") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "New project", exact: true }).click(),
  ]);
  expect(resp.ok(), `create-project POST should succeed, got ${resp.status()}`).toBeTruthy();
});
