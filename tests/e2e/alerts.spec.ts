import { test, expect } from "@playwright/test";

// Journey: create an alert from Settings -> Alerts and confirm it persists.
// Drives the real form and asserts on the POST /api/v0/alerts response, then
// checks the new alert shows up in the list (a real read-back from the DB).

test("create an alert and see it in the list", async ({ page }) => {
  // A name unique enough to assert on without colliding with the 6 seeded alerts.
  const name = "E2E threshold check";

  await page.goto("/settings");
  await page.getByRole("button", { name: "Alerts" }).click();
  await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();

  await page.getByRole("button", { name: "New alert" }).click();
  await expect(page.getByRole("heading", { name: "New Alert" })).toBeVisible();

  // Only name + threshold are required; metric/condition/window use defaults.
  await page.getByPlaceholder("High error rate").fill(name);
  await page.getByRole("spinbutton").fill("500");

  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v0/alerts") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  expect(resp.ok(), `create-alert POST should succeed, got ${resp.status()}`).toBeTruthy();

  // The list reloads from the API after create; the new alert should appear.
  await expect(page.getByText(name)).toBeVisible();
});
