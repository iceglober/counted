import { expect, test } from "@playwright/test";
import { Counted } from "../../packages/sdk-js/src/client";
import { browserSettings } from "./settings";
import { account, addMember, canceledSubscription, dashboardWithInsights, invitation, noHorizontalOverflow, post, projectWithEvents, uniqueName } from "./fixtures";

test("password sign-in returns to the requested workspace page", async ({ page }) => {
  const fixture = await account(page);
  await page.context().clearCookies();
  const destination = `/w/${fixture.workspaceId}/projects?archived=1`;
  await page.goto(destination);
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(destination)}`));
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await expect(page.getByRole("button", { name: "Sign in with link", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${fixture.workspaceId}/projects\\?archived=1$`));
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("new project uses a contained modal and opens its installation flow", async ({ page }, testInfo) => {
  const fixture = await account(page);
  await page.goto(`/w/${fixture.workspaceId}/projects`);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const name = uniqueName();
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+\?setup=1$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your app", exact: true })).toBeVisible();
  const code = await page.getByTestId("setup-code").innerText();
  const secret = JSON.parse(code.match(/key: ("[^"\n]+")/)![1]!);
  expect(secret).toMatch(/^ck_/);
  expect(code).not.toContain("YOUR_INGEST_KEY");
  await expect(page.getByRole("button", { name: "Copy code", exact: true })).toBeEnabled();
  await expect(page.getByText("Waiting for your first event.", { exact: false })).toBeVisible();
  const projectPath = new URL(page.url()).pathname;
  const projectId = projectPath.split("/").at(-1)!;
  const credentials = await page.request.get(`/api/v1/projects/${projectId}/credentials`);
  const keys = await credentials.json();
  expect(keys.items).toHaveLength(1);
  expect(keys.items[0]).toMatchObject({ kind: "ingest", permissions: ["events:write"] });
  expect(JSON.stringify(keys)).not.toContain(secret);
  expect(page.url()).not.toContain(secret);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(secret);

  // The actual SDK and its normal automatic flush, not a manually crafted event.
  const counted = new Counted({ key: secret, endpoint: `${browserSettings().apiUrl}/v1/events` });
  try {
    counted.track("page_view", { path: "/welcome" });
    await expect(page.getByText("Connected. Events are arriving from your app.", { exact: true })).toBeVisible({ timeout: 25000 });
    const row = page.getByRole("row").filter({ hasText: "page_view" });
    await expect(row.getByRole("cell", { name: "1", exact: true })).toBeVisible();
  } finally { await counted.shutdown(); }
  await page.screenshot({ path: `/tmp/counted-dx-${testInfo.project.name}.png`, fullPage: true });
  await noHorizontalOverflow(page);
  await page.reload();
  await expect(page.getByTestId("setup-code")).toContainText("YOUR_INGEST_KEY");
  await expect(page.getByTestId("setup-code")).not.toContainText(secret);
  // Pasting a saved key must not dismiss the input after its first character.
  await page.getByLabel("Ingest key", { exact: true }).pressSequentially(secret);
  await expect(page.getByLabel("Ingest key", { exact: true })).toHaveValue(secret);
  await expect(page.getByTestId("setup-code")).toContainText(secret);
  await noHorizontalOverflow(page);
});

test("an Insight wizard preserves its property filter through edit and reload", async ({ page }) => {
  const fixture = await account(page);
  await projectWithEvents(page, fixture.workspaceId);
  const { dashboard } = await post<{ dashboard: { id: string } }>(page.request, `/v1/workspaces/${fixture.workspaceId}/dashboards`, { name: "Browser insights" });
  await page.goto(`/w/${fixture.workspaceId}/dashboards/${dashboard.id}`);
  await page.getByRole("button", { name: "New insight", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByLabel("Events", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Add filter", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Filter 1 property", exact: true }).click();
  await page.getByRole("option", { name: "path", exact: true }).click();
  await dialog.getByLabel("Filter 1 value", { exact: true }).fill("/pricing");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByLabel("Title", { exact: true }).fill("Filtered views");
  await dialog.getByRole("button", { name: "Add insight", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Edit insight: Filtered views", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByLabel("Filter 1 value", { exact: true })).toHaveValue("/pricing");
  await dialog.getByLabel("Filter 1 value", { exact: true }).fill("/docs");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByLabel("Title", { exact: true }).fill("Documentation views");
  await dialog.getByRole("button", { name: "Save insight", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit insight: Documentation views", exact: true })).toBeVisible();
  const response = await page.request.get(`/api/v1/dashboards/${dashboard.id}`);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ dashboard: { tiles: [{ title: "Documentation views", analysis: { where: { op: "eq", field: { source: "property", key: "path" }, value: "/docs" } } }] } });
  await noHorizontalOverflow(page);
});

test("plan frequency changes the displayed quote and members cannot open checkout", async ({ page }) => {
  const owner = await account(page);
  const planPath = `/w/${owner.workspaceId}/settings?tab=plan`;
  await page.goto(planPath);
  await expect(page.getByText("$9.90", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Pro billing frequency", exact: true }).click();
  await page.getByRole("option", { name: "Annually", exact: true }).click();
  await expect(page.getByText("$99.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro", exact: true })).toBeEnabled();
  await noHorizontalOverflow(page);

  await canceledSubscription(owner.workspaceId);
  await page.reload();
  await expect(page.getByRole("columnheader", { name: /^Free · current$/i })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^Pro · current$/i })).toHaveCount(0);
  await expect(page.getByText(/^Free plan\. Your paid subscription has ended\.$/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Manage billing", exact: true })).toBeVisible();
  await expect(page.getByText("Next renewal", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Base price", { exact: true })).toHaveCount(0);
  await noHorizontalOverflow(page);

  await page.context().clearCookies();
  const member = await account(page);
  await addMember(owner.workspaceId, member.accountId);
  await page.goto(planPath);
  await expect(page.getByText("Only an owner can change the plan or open billing.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upgrade to Pro", exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Pro billing frequency", exact: true })).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test("an invitation rejects the wrong account and continues sign-in to recipient acceptance", async ({ page }) => {
  const recipient = await account(page);
  await page.context().clearCookies();
  const owner = await account(page);
  const path = await invitation(owner.workspaceId, owner.accountId, recipient.email);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Workspace invitation", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Invitations must be accepted with the invited email address." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Use another account", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}`));
  await page.getByLabel("Email", { exact: true }).fill(recipient.email);
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(recipient.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${owner.workspaceId}/dashboards$`));
  await expect(page.getByRole("heading", { name: "Dashboards", exact: true })).toBeVisible();
  const membership = await page.request.get(`/api/v1/workspaces/${owner.workspaceId}/members`);
  expect(membership.ok()).toBe(true);
  expect(await membership.json()).toMatchObject({ items: expect.arrayContaining([{ account: expect.objectContaining({ id: recipient.accountId }), role: "member", since: expect.any(String) }]) });
  await noHorizontalOverflow(page);
});

test("dashboard size controls save a layout that survives reload", async ({ page }, testInfo) => {
  const fixture = await account(page);
  const dashboard = await dashboardWithInsights(page, fixture.workspaceId);
  await page.goto(`/w/${fixture.workspaceId}/dashboards/${dashboard.id}`);
  await page.getByRole("button", { name: "Edit layout", exact: true }).click();
  await page.getByRole("button", { name: "Size and position: Page views", exact: true }).click();
  await page.getByRole("button", { name: "Increase height", exact: true }).click();
  if (testInfo.project.name === "desktop") await page.getByRole("button", { name: "Decrease width", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByText("Layout saved.", { exact: true })).toBeVisible();
  const response = await page.request.get(`/api/v1/dashboards/${dashboard.id}`);
  expect(response.ok()).toBe(true);
  const saved = await response.json() as { dashboard: { tiles: { id: string; width: number; layout: { x: number; y: number; height: number } }[] } };
  const tile = saved.dashboard.tiles.find(one => one.id === dashboard.tiles[0]!.id)!;
  expect(tile.layout.height).toBeGreaterThan(3);
  expect(tile.width).toBe(testInfo.project.name === "desktop" ? 5 : 6);
  await page.reload();
  await page.getByRole("button", { name: "Edit layout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save layout", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Size and position: Page views", exact: true }).click();
  await expect(page.getByText("Size and position", { exact: true })).toBeVisible();
  const controls = page.getByRole("button", { name: "Increase height", exact: true }).locator("..");
  await expect(controls.locator("output")).toHaveText(String(tile.layout.height));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const reloaded = await page.request.get(`/api/v1/dashboards/${dashboard.id}`);
  expect((await reloaded.json()).dashboard.tiles).toEqual(saved.dashboard.tiles);
  await noHorizontalOverflow(page);
});

test("a shared dashboard is readable without an account until its owner revokes the link", async ({ page, browser }) => {
  const fixture = await account(page);
  const dashboard = await dashboardWithInsights(page, fixture.workspaceId);
  await page.goto(`/w/${fixture.workspaceId}/dashboards/${dashboard.id}/settings`);
  await page.getByRole("button", { name: "Create share link", exact: true }).click();
  const link = page.getByText(/^http:\/\/127\.0\.0\.1:3300\/share\//);
  await expect(link).toBeVisible();
  const shareUrl = await link.innerText();
  const guest = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const shared = await guest.newPage();
    await shared.goto(shareUrl);
    await expect(shared.getByRole("heading", { name: dashboard.name, exact: true })).toBeVisible();
    await expect(shared.getByRole("heading", { name: "Page views", exact: true })).toBeVisible();
    await expect(shared.getByText("Shared dashboard · Read-only", { exact: true })).toBeVisible();
    await expect(shared.getByRole("button", { name: "Edit layout", exact: true })).toHaveCount(0);
    await expect(shared.getByRole("button", { name: "Edit insight: Page views", exact: true })).toHaveCount(0);
    await noHorizontalOverflow(shared);

    await page.getByRole("button", { name: "Revoke share link", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke share link", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create share link", exact: true })).toBeVisible();
    await shared.reload();
    await expect(shared.getByRole("heading", { name: "Not available", exact: true })).toBeVisible();
    await expect(shared.getByRole("heading", { name: dashboard.name, exact: true })).toHaveCount(0);
  } finally { await guest.close(); }
});

test("workspace service keys have a contained, permission-scoped lifecycle", async ({ page }, testInfo) => {
  const fixture = await account(page);
  const path = `/api/v1/workspaces/${fixture.workspaceId}/credentials`;
  await page.goto(`/w/${fixture.workspaceId}/settings`);
  await page.getByRole("button", { name: "New service key", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace service key", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("workspace-key-dialog.png"), animations: "disabled" });
  await dialog.getByLabel("Name", { exact: true }).fill("Narrow browser key");
  await dialog.getByRole("combobox", { name: "Permissions", exact: true }).click();
  await page.getByRole("option", { name: "Read projects", exact: true }).click();
  await page.getByRole("option", { name: "Read workspace details", exact: true }).click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Issue key", exact: true }).click();
  await expect(dialog.getByText("Copy this key before closing.", { exact: false })).toBeVisible();
  const secret = await dialog.locator("code").innerText();
  const listing = await (await page.request.get(path)).json();
  const key = listing.items.find((one: { name: string }) => one.name === "Narrow browser key");
  expect(key.permissions).toEqual(["queries:run"]);
  expect(JSON.stringify(listing)).not.toContain(secret);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New service key", exact: true }).click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Key details: Narrow browser key", exact: true }).click();
  await page.getByRole("button", { name: "Rotate", exact: true }).click();
  const rotation = page.getByRole("dialog", { name: "Rotate workspace key", exact: true });
  await rotation.getByLabel("Grace period (days)", { exact: true }).fill("0");
  await rotation.getByRole("button", { name: "Rotate key", exact: true }).click();
  await expect(rotation.getByText("Replacement secret", { exact: true })).toBeVisible();
  const replacementSecret = await rotation.locator("code").innerText();
  expect(replacementSecret).not.toBe(secret);
  await rotation.getByRole("button", { name: "Close", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  const rows = page.getByRole("table", { name: "Workspace keys", exact: true }).getByRole("row");
  const active = rows.filter({ hasText: "Expiring" });
  await active.getByRole("button", { name: "Key details: Narrow browser key", exact: true }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("workspace-keys.png"), fullPage: true });

  const member = await account(page);
  await addMember(fixture.workspaceId, member.accountId);
  await page.goto(`/w/${fixture.workspaceId}/settings`);
  await expect(page.getByRole("button", { name: "New service key", exact: true })).toHaveCount(0);
  expect((await page.request.post(path, { data: { name: "refused", permissions: ["queries:run"] } })).status()).toBe(403);
});
