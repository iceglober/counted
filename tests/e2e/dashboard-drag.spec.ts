import { test, expect } from "@playwright/test";
import { seededDashboardId } from "./helpers";

// Drag visuals: the held item shrinks to a compact overlay chip, and the grid
// never overflows the right edge while siblings reflow (they wrap downward).
test("drag shows a shrunk overlay and never overflows right", async ({ page }) => {
  await page.goto(`/dashboards?dashboard=${await seededDashboardId(page.request)}`);
  const cells = page.locator("[data-insight-id]");
  await expect(async () => expect(await cells.count()).toBeGreaterThan(2)).toPass();

  // Pick up the first card via pointer (dnd-kit needs a >5px move to activate).
  const handle = page.locator("[data-drag-handle]").first();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 10 }); // drag across/down

  // The held item renders as a compact (~224px) overlay chip, not a full card.
  const overlay = page.locator("[data-drag-overlay]");
  await expect(overlay).toBeVisible();
  const ob = (await overlay.boundingBox())!;
  expect(ob.width).toBeLessThan(300);

  // No horizontal overflow while siblings reflow.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page overflowed right by ${overflow}px during drag`).toBeLessThanOrEqual(1);

  await page.mouse.up();
});
