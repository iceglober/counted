import { test, expect } from "@playwright/test";

// Journey: build a funnel insight (>=2 steps), then convert it to a retention
// insight. Funnel/retention previews are computed client-side, so the signal
// is the layout PUT (the query is only valid once a funnel has 2+ steps).

test("build a funnel, then convert it to retention", async ({ page }) => {
  await page.goto("/dashboards");
  await page.getByRole("button", { name: "Add insight" }).click();

  // Switch the insight type to Funnel — reveals the steps picker (needs schema).
  await page.getByRole("button", { name: "Funnel", exact: true }).click();

  // Add two funnel steps. The "Add step..." dropdown closes after each pick.
  await page.getByRole("button", { name: /add step/i }).click();
  await page.getByRole("button", { name: /^page_view/ }).click();
  await page.getByRole("button", { name: /add step/i }).click();
  await page.getByRole("button", { name: /^button_click/ }).click();

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
