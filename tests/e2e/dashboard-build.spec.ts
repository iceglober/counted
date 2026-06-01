import { test, expect } from "@playwright/test";

// Journey: build an insight on the default dashboard end to end —
// add -> configure (breakdown group-by) -> property filter -> live preview ->
// auto-persist -> resize. Exercises the configurator, the /api/v0/query preview,
// and the PUT /api/v0/dashboards layout persistence.

const TITLE = "E2E built insight";

test("add, configure, preview, persist, and resize an insight", async ({ page }) => {
  await page.goto("/dashboards");
  await expect(page.getByRole("link", { name: "Dashboards" })).toBeVisible();

  // Add a fresh insight — opens the configurator (defaults to breakdown).
  await page.getByRole("button", { name: "Add insight" }).click();

  // Title: at this moment the auto-title placeholder is "Total events".
  await page.getByPlaceholder("Total events").fill(TITLE);

  // A breakdown needs a group-by before the query is valid. Pick a system field.
  await page.getByRole("button", { name: /select field/i }).click();
  await page.getByRole("button", { name: "Operating system", exact: true }).click();

  // Group-by makes the query valid -> live preview fires a query and the layout
  // auto-persists (800ms debounce). Wait for both real network calls.
  await page.waitForResponse(
    (r) => r.url().includes("/api/v0/query") && r.request().method() === "POST" && r.ok(),
  );
  const firstPersist = await page.waitForResponse(
    (r) => r.url().includes("/api/v0/dashboards/") && r.request().method() === "PUT",
  );
  expect(firstPersist.ok(), `layout PUT should succeed, got ${firstPersist.status()}`).toBeTruthy();

  // Preview rendered: the meta line "<n> rows · <ms>ms" only shows on a result.
  await expect(page.getByText(/\d+ rows? · \d+ms/)).toBeVisible();

  // Add a property filter on a system field with known values (Locale -> en-US).
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("button", { name: /^Field\.\.\.$/ }).click();
  await page.getByRole("button", { name: "Locale", exact: true }).click();
  await page.getByRole("button", { name: /^Value\.\.\.$/ }).click();
  await page.getByRole("button", { name: "en-US", exact: true }).click();
  // Filter triggers a fresh preview query.
  await page.waitForResponse(
    (r) => r.url().includes("/api/v0/query") && r.request().method() === "POST" && r.ok(),
  );

  // Dismiss the configurator; the grid repaints from /api/v0/dashboard-data.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText(TITLE)).toBeVisible();

  // Resize the new (span-2) insight; the next size in the cycle is "Full width".
  const card = page.locator("div.group\\/insight").filter({ hasText: TITLE });
  await card.hover();
  const [resizePut] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v0/dashboards/") && r.request().method() === "PUT",
    ),
    card.getByRole("button", { name: "Full width" }).click(),
  ]);
  expect(resizePut.ok(), `resize PUT should succeed, got ${resizePut.status()}`).toBeTruthy();
});
