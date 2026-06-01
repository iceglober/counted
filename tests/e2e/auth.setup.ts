import { test as setup, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { Pool } from "pg";

const AUTH_FILE = "tests/e2e/.auth/state.json";
const EMAIL = "test@counted.dev"; // the seeded user (has projects + dashboards + data)
const DB_URL = process.env.DATABASE_URL ?? "postgres://counted:counted@localhost:5434/counted";

/** Fetch the most recent magic-link token for an email from the verification table. */
async function magicLinkToken(email: string): Promise<string> {
  const pool = new Pool({ connectionString: DB_URL });
  try {
    const r = await pool.query<{ identifier: string }>(
      `SELECT identifier FROM verification
       WHERE value::jsonb->>'email' = $1
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (!r.rows[0]) throw new Error(`no verification token for ${email}`);
    return r.rows[0].identifier;
  } finally {
    await pool.end();
  }
}

setup("seed database and authenticate", async ({ page }) => {
  // 1. Reseed: re-runnable, gives us test@counted.dev with projects, dashboards, and data.
  execSync("bun scripts/seed.ts", { stdio: "inherit", env: { ...process.env, DATABASE_URL: DB_URL } });

  // 2. Request a magic link (no email is actually sent in dev; the token lands in the DB).
  const send = await page.request.post("/api/auth/sign-in/magic-link", {
    data: { email: EMAIL, callbackURL: "/dashboards" },
  });
  expect(send.ok()).toBeTruthy();

  // 3. Complete the magic link by visiting the verify URL — sets the session cookie.
  const token = await magicLinkToken(EMAIL);
  await page.goto(`/api/auth/magic-link/verify?token=${token}&callbackURL=/dashboards`);

  // 4. Confirm we're authenticated, then persist the storage state for the authed project.
  const session = await page.request.get("/api/auth/get-session");
  const body = await session.json();
  expect(body?.user?.email, "magic-link login should establish a session").toBe(EMAIL);

  await page.context().storageState({ path: AUTH_FILE });
});
