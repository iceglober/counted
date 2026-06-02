import { test, expect } from "@playwright/test";
import { seededDashboardId } from "./helpers";

// Drag visuals (react-grid-layout): only the held card shrinks onto the cursor;
// every other card stays inside the grid at its size and just reflows.
test("dragged card shrinks; siblings never leave the grid", async ({ page }) => {
  await page.goto(`/dashboards?dashboard=${await seededDashboardId(page.request)}`);
  const cells = page.locator("[data-insight-id]");
  await expect(async () => expect(await cells.count()).toBeGreaterThan(2)).toPass();
  await page.waitForTimeout(400); // let react-grid-layout finish measuring/wiring drag

  // Pick up the first card and drag it across/down.
  const handle = page.locator("[data-drag-handle]").first();
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 60, { steps: 6 });
  await page.mouse.move(hb.x + 160, hb.y + 220, { steps: 12 });

  // The held card is scaled down to a chip — well under its own grid cell width
  // (robust to even-width rows, where cells vary in width).
  const draggingItem = page.locator(".react-grid-item.react-draggable-dragging");
  const draggingCard = draggingItem.locator(".insight-card");
  await expect(draggingCard).toBeVisible();
  const cellW = (await draggingItem.boundingBox())!.width;
  const dw = (await draggingCard.boundingBox())!.width;
  expect(dw, `held card should scale down within its cell (cell ${cellW}px)`).toBeLessThan(cellW * 0.6);

  // No NON-dragged card extends past the grid's right edge — siblings reflow
  // within the grid (wrap downward) rather than warping off-screen.
  const worst = await page.evaluate(() => {
    const grid = document.querySelector(".react-grid-layout")!.getBoundingClientRect();
    const siblings = document.querySelectorAll(".react-grid-item:not(.react-draggable-dragging) [data-insight-id]");
    return Math.max(0, ...[...siblings].map((c) => c.getBoundingClientRect().right - grid.right));
  });
  expect(worst, `a sibling overflowed the grid right by ${worst}px`).toBeLessThanOrEqual(2);

  await page.mouse.up();
});
