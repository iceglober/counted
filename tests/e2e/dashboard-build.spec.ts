import { test, expect } from "@playwright/test";
import { seededDashboardId } from "./helpers";

// Journey: build an insight on the default dashboard end to end —
// add -> configure (breakdown group-by) -> property filter -> live preview ->
// auto-persist -> resize. Exercises the configurator, the /api/v0/query preview,
// and the PUT /api/v0/dashboards layout persistence.

const TITLE = "E2E built insight";

test("add, configure, preview, persist, and resize an insight", async ({ page }) => {
  await page.goto(`/dashboards?dashboard=${await seededDashboardId(page.request)}`);
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

test("resize an insight by dragging its handle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(`/dashboards?dashboard=${await seededDashboardId(page.request)}`);

  const item = page.locator(".react-grid-item").first();
  await expect(item).toBeVisible();
  await page.waitForTimeout(400);
  const before = (await item.boundingBox())!;

  await item.hover();
  const handle = item.locator(".react-resizable-handle-se");
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 220, hb.y + 160, { steps: 12 }); // enlarge
  const [resizePut] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v0/dashboards/") && r.request().method() === "PUT",
    ),
    page.mouse.up(),
  ]);
  expect(resizePut.ok(), `resize PUT should succeed, got ${resizePut.status()}`).toBeTruthy();

  // The card actually grew.
  await expect(async () => {
    const after = (await item.boundingBox())!;
    expect(after.width + after.height).toBeGreaterThan(before.width + before.height + 20);
  }).toPass();
});

test("reorder insights by drag-and-drop", async ({ page }) => {
  // Tall viewport so every cell (and the drop target) is on-screen.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(`/dashboards?dashboard=${await seededDashboardId(page.request)}`);

  // react-grid-layout cells carry data-insight-id in DOM (== layout) order.
  const cells = page.locator("[data-insight-id]");
  await expect(async () => expect(await cells.count()).toBeGreaterThan(2)).toPass();
  await page.waitForTimeout(400); // let RGL finish measuring/wiring drag
  const order = () =>
    cells.evaluateAll((els) => els.map((e) => e.getAttribute("data-insight-id")));
  const before = await order();

  // Pointer-drag the first card's handle onto the third card's position.
  const handle = page.locator("[data-drag-handle]").first();
  const hb = (await handle.boundingBox())!;
  const dest = (await cells.nth(2).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 30, hb.y + 30, { steps: 5 }); // pass the drag threshold
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 12 });
  const [dragPut] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/v0/dashboards/") && r.request().method() === "PUT",
    ),
    page.mouse.up(), // drop -> onDragStop -> persistLayout
  ]);
  expect(dragPut.ok(), `reorder PUT should succeed, got ${dragPut.status()}`).toBeTruthy();

  // The layout order changed.
  await expect(async () => {
    const after = await order();
    expect(after.join(",")).not.toBe(before.join(","));
  }).toPass();
});
