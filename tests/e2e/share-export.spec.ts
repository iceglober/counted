import { test, expect } from "@playwright/test";

// Journeys: public dashboard sharing and per-project data export.
// Runs in the authed project (storageState = seeded test@counted.dev), so
// page.request carries the session cookie. The public-share check then opens a
// fresh, cookie-less context to prove the /share/[token] route needs no auth.

async function firstProjectId(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get("/api/v0/projects");
  expect(res.ok(), `GET /api/v0/projects -> ${res.status()}`).toBeTruthy();
  const projects = await res.json();
  expect(projects.length, "seed should create projects").toBeGreaterThan(0);
  return projects[0].id as string;
}

test("share a dashboard, then view it read-only without auth", async ({ page, browser }) => {
  const projectId = await firstProjectId(page.request);

  const list = await page.request.get(`/api/v0/dashboards?projectId=${projectId}`);
  expect(list.ok(), `GET /api/v0/dashboards -> ${list.status()}`).toBeTruthy();
  const dashboards = await list.json();
  expect(dashboards.length, "seed should create dashboards").toBeGreaterThan(0);
  const dashboard = dashboards[0];

  // Generate a fresh share token (exercises the share mutation).
  const share = await page.request.post(`/api/v0/dashboards/${dashboard.id}/share`);
  expect(share.ok(), `POST .../share -> ${share.status()}`).toBeTruthy();
  const { shareToken } = await share.json();
  expect(shareToken, "share endpoint should return a token").toBeTruthy();

  // Anonymous context: no storage state, so no session cookie.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  try {
    const res = await anonPage.goto(`/share/${shareToken}`);
    expect(res?.status(), "public share route should render for anonymous users").toBeLessThan(400);
    await expect(anonPage.getByRole("heading", { name: dashboard.name })).toBeVisible();
    await expect(anonPage.getByRole("link", { name: /get your own dashboard/i })).toBeVisible();
    // Read-only: none of the authoring affordances should be present.
    await expect(anonPage.getByRole("button", { name: /add insight/i })).toHaveCount(0);
  } finally {
    await anon.close();
  }

  // An unknown token 404s.
  const missing = await page.request.get("/share/deadbeefdeadbeefdeadbeefdeadbeef");
  expect(missing.status(), "unknown share token should 404").toBe(404);
});

test("export project events as CSV and JSON", async ({ page }) => {
  const projectId = await firstProjectId(page.request);

  const csv = await page.request.get(`/api/v0/projects/${projectId}/export?format=csv`);
  expect(csv.ok(), `export csv -> ${csv.status()}`).toBeTruthy();
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(csv.headers()["content-disposition"]).toContain("events-export.csv");
  const csvBody = await csv.text();
  // Header row first, then at least one seeded event row.
  expect(csvBody.split("\n")[0]).toContain("event_name");
  expect(csvBody.trim().split("\n").length).toBeGreaterThan(1);

  const json = await page.request.get(`/api/v0/projects/${projectId}/export?format=json`);
  expect(json.ok(), `export json -> ${json.status()}`).toBeTruthy();
  expect(json.headers()["content-disposition"]).toContain("events-export.json");
  const rows = await json.json();
  expect(Array.isArray(rows), "json export should be an array").toBeTruthy();
  expect(rows.length, "seeded project should export events").toBeGreaterThan(0);
  expect(rows[0]).toHaveProperty("event_name");
});
