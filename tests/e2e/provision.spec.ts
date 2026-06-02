import { test, expect } from "@playwright/test";

// Agent zero-signup flow: provision an anonymous project, ingest into it, then a
// logged-in user claims it and it attaches to their account.
test("provision an anonymous project, ingest, then claim it", async ({ page }) => {
  const prov = await (await page.request.post("/api/v0/provision")).json();
  expect(prov.clientKey, "provision returns a client key").toMatch(/^ck_/);
  expect(prov.claimUrl).toContain("/claim/");

  // Events flow into the unclaimed project immediately.
  const ev = await page.request.post("/api/v0/event", {
    headers: { "Project-Key": prov.clientKey, "Content-Type": "application/json" },
    data: {
      eventName: "provisioned_test",
      sessionId: "prov-session",
      timestamp: new Date().toISOString(),
      props: {},
      systemProps: { sdkVersion: "test", isDebug: true },
    },
  });
  expect(ev.status(), "ingest into unclaimed project").toBe(202);

  // The seeded user (logged in) claims it → redirected to their dashboards.
  const token = prov.claimUrl.split("/claim/")[1];
  await page.goto(`/claim/${token}`);
  await expect(page).toHaveURL(/\/dashboards/);

  // The project is now owned by the user.
  const projects = await (await page.request.get("/api/v0/projects")).json();
  expect(
    projects.some((p: { clientKey?: string }) => p.clientKey === prov.clientKey),
    "claimed project is owned by the user",
  ).toBeTruthy();

  // Re-visiting the claim link is now invalid (token cleared, single-use).
  await page.goto(`/claim/${token}`);
  await expect(page.getByRole("heading", { name: /isn.t valid/i })).toBeVisible();
});
