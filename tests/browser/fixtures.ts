import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { browserSettings } from "./settings";

export const uniqueName = () => `Browser ${randomUUID().slice(0, 8)}`;

export async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`/api${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return await response.json() as T;
}

export async function account(page: Page) {
  // The suite's local API stands in for the edge during fixture signup. Each
  // fixture has its own client address, so setup does not exhaust one shared
  // browser-proxy bucket. Auth throttling stays enabled and is tested over HTTP.
  const email = `browser-${randomUUID()}@example.test`;
  const password = `${randomUUID()}aA1!`;
  const address = randomUUID().replaceAll("-", "");
  const response = await page.request.post(`${browserSettings().apiUrl}/api/auth/sign-up/email`, {
    headers: { origin: browserSettings().webUrl, "x-forwarded-for": `198.19.${parseInt(address.slice(0, 2), 16)}.${parseInt(address.slice(2, 4), 16)}` },
    data: { email, password, name: uniqueName() },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const result = await response.json() as { user: { id: string } };
  const { workspace } = await post<{ workspace: { id: string } }>(page.request, "/v1/workspaces", { name: uniqueName() });
  return { email, password, accountId: result.user.id, workspaceId: workspace.id };
}

export async function projectWithEvents(page: Page, workspaceId: string) {
  const { project } = await post<{ project: { id: string; name: string } }>(page.request, `/v1/workspaces/${workspaceId}/projects`, { name: "Web fixture" });
  const { issued } = await post<{ issued: { secret: string } }>(page.request, `/v1/projects/${project.id}/credentials`, { name: "Browser fixture", kind: "ingest" });
  const response = await page.request.post(`${browserSettings().apiUrl}/v1/events`, {
    headers: { authorization: `Bearer ${issued.secret}` },
    data: { events: [
      { name: "page_view", visitId: randomUUID(), properties: { path: "/pricing" } },
      { name: "page_view", visitId: randomUUID(), properties: { path: "/docs" } },
      { name: "page_view", visitId: randomUUID(), properties: { path: "/docs" } },
    ] },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return project;
}

/** Fixture setup only: the suite owns the whole database and deletes it on exit. */
export async function addMember(workspaceId: string, accountId: string) {
  const pool = new Pool({ connectionString: browserSettings().databaseUrl });
  try {
    await pool.query('INSERT INTO auth.member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, $5)', [randomUUID(), workspaceId, accountId, "member", new Date()]);
  } finally { await pool.end(); }
}

/** Historical Pro state after cancellation, including an old paid-period date. */
export async function canceledSubscription(workspaceId: string) {
  const pool = new Pool({ connectionString: browserSettings().databaseUrl });
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("UPDATE public.workspaces SET plan = 'pro', payment_state = 'canceled' WHERE id = $1", [workspaceId]);
    await connection.query("UPDATE public.subscriptions SET plan = 'pro', payment_state = 'canceled', customer_ref = $2, subscription_ref = $3, renews_at = $4 WHERE workspace_id = $1", [workspaceId, `cus_browser_${workspaceId}`, `sub_browser_${workspaceId}`, new Date(Date.now() + 86_400_000)]);
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); await pool.end(); }
}

/** A captured invitation fixture: no provider is contacted and no email is sent. */
export async function invitation(workspaceId: string, inviterId: string, email: string) {
  const id = randomUUID();
  const pool = new Pool({ connectionString: browserSettings().databaseUrl });
  try {
    await pool.query('INSERT INTO auth.invitation (id, "organizationId", "inviterId", email, role, status, "expiresAt", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, workspaceId, inviterId, email, "member", "pending", new Date(Date.now() + 86_400_000), new Date()]);
  } finally { await pool.end(); }
  return `/invitations/${id}`;
}

export async function dashboardWithInsights(page: Page, workspaceId: string) {
  const project = await projectWithEvents(page, workspaceId);
  const { dashboard } = await post<{ dashboard: { id: string; name: string } }>(page.request, `/v1/workspaces/${workspaceId}/dashboards`, { name: uniqueName() });
  const tiles = [];
  for (const title of ["Page views", "Documentation views"]) {
    const { tile } = await post<{ tile: { id: string; title: string } }>(page.request, `/v1/dashboards/${dashboard.id}/tiles`, {
      title, project: project.id, view: "number", width: 6,
      analysis: { shape: "scalar", measure: { kind: "count" }, window: { kind: "relative", amount: 7, unit: "day" }, summary: "total" },
    });
    tiles.push(tile);
  }
  return { ...dashboard, tiles };
}

export async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
