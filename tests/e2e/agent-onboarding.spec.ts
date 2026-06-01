import { test, expect } from "@playwright/test";

// A new agent project (zero events) should surface the plugin-setup card on its
// dashboard, with install instructions for Claude Code and OpenCode + the key.
test("agent dashboard shows the plugin-setup card until first event", async ({ page }) => {
  const res = await page.request.post("/api/v0/projects", {
    data: { name: "E2E Agent", template: "agent" },
  });
  expect(res.ok(), `create agent project -> ${res.status()}`).toBeTruthy();
  const project = await res.json();

  const dashes = await (await page.request.get(`/api/v0/dashboards?projectId=${project.id}`)).json();
  const dash = dashes[0];

  await page.goto(`/dashboards?dashboard=${dash.id}`);

  await expect(page.getByRole("heading", { name: "Connect your coding agent" })).toBeVisible();
  // Claude Code tab (default) shows the install command + the client key.
  await expect(page.getByText("/plugin install claude-code@counted")).toBeVisible();
  await expect(page.getByText(project.clientKey)).toBeVisible();

  // OpenCode tab swaps to the opencode.json snippet.
  await page.getByRole("button", { name: "OpenCode", exact: true }).click();
  await expect(page.getByText('"plugin": ["@counted/opencode"]')).toBeVisible();
});
