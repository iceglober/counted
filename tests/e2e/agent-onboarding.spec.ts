import { test, expect } from "@playwright/test";

// An agent-template dashboard (zero events) should surface the plugin-setup
// card, with install instructions for Claude Code and OpenCode + the key.
test("agent dashboard shows the plugin-setup card until first event", async ({ page }) => {
  // A fresh project (its own client key) + an agent-template dashboard in it.
  const projRes = await page.request.post("/api/v0/projects", { data: { name: "E2E Agent" } });
  expect(projRes.ok(), `create project -> ${projRes.status()}`).toBeTruthy();
  const project = await projRes.json();

  const dashRes = await page.request.post("/api/v0/dashboards", {
    data: { projectId: project.id, slug: `agent-${Date.now()}`, template: "agent" },
  });
  expect(dashRes.ok(), `create agent dashboard -> ${dashRes.status()}`).toBeTruthy();
  const dash = await dashRes.json();

  await page.goto(`/dashboards?dashboard=${dash.id}`);

  await expect(page.getByRole("heading", { name: "Connect your coding agent" })).toBeVisible();
  // Claude Code tab (default) shows the install command + the client key.
  await expect(page.getByText("/plugin install claude-code@counted")).toBeVisible();
  await expect(page.getByText(project.clientKey)).toBeVisible();

  // OpenCode tab swaps to the opencode.json snippet.
  await page.getByRole("button", { name: "OpenCode", exact: true }).click();
  await expect(page.getByText('"plugin": ["@counted/opencode"]')).toBeVisible();
});
