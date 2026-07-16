import { test, expect } from "@playwright/test";
import { seededDashboardId } from "./helpers";

// Journey: build a funnel insight (>=2 steps), then convert it to a retention
// insight. Funnel/retention previews are computed client-side, so the signal
// is the layout PUT (the query is only valid once a funnel has 2+ steps).

test("build a funnel, then convert it to retention", async ({ page }) => {
  await page.goto(`/dashboards?dashboard=${await seededDashboardId(page.request)}`);
  await page.getByRole("button", { name: "Add insight" }).click();

  // Switch the insight type to Funnel — reveals the steps picker (needs schema).
  await page.getByRole("button", { name: "Funnel", exact: true }).click();

  // Add two funnel steps via the combobox: type an event name and press Enter.
  const stepInput = page.getByPlaceholder(/add step/i);
  await stepInput.fill("page_view");
  await stepInput.press("Enter");
  await stepInput.fill("sign_up");
  await stepInput.press("Enter");

  // Two steps make the funnel query valid -> layout auto-persists.
  const funnelPut = await page.waitForResponse(
    (r) => r.url().includes("/api/v0/dashboards/") && r.request().method() === "PUT",
  );
  expect(funnelPut.ok(), `funnel PUT should succeed, got ${funnelPut.status()}`).toBeTruthy();

  // Convert to Retention — always a valid query, so it persists too.
  await page.getByRole("button", { name: "Retention", exact: true }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  const retentionPut = await page.waitForResponse(
    (r) => r.url().includes("/api/v0/dashboards/") && r.request().method() === "PUT",
  );
  expect(retentionPut.ok(), `retention PUT should succeed, got ${retentionPut.status()}`).toBeTruthy();

  await page.getByRole("button", { name: "Done", exact: true }).click();
});
