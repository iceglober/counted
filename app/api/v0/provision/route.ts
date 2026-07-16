import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { generateClientKey, generateServerKey } from "@/lib/api-key";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { randomBytes } from "node:crypto";

// Durable backstop: the in-memory limiter resets on every redeploy, so an
// attacker can mass-provision again after each restart. This global DB-level
// ceiling on unclaimed projects minted in the trailing hour bounds the blast
// radius across restarts. It is intentionally NOT keyed on IP — Counted never
// stores client IPs (privacy invariant) — so it is a global abuse ceiling, not a
// per-IP counter. Set generously so legitimate agent onboarding is unaffected.
const HOURLY_UNCLAIMED_CAP = 500;

// Reaper throttle: run the expired-unclaimed cleanup at most this often.
const REAPER_INTERVAL_MS = 10 * 60 * 1000;
let lastReapAt = 0;

// Best-effort delete of abandoned unclaimed projects: older than the 7-day
// ingest cutoff and never used (no events, so no FK to violate).
async function reapExpiredUnclaimed(): Promise<void> {
  if (Date.now() - lastReapAt < REAPER_INTERVAL_MS) return;
  lastReapAt = Date.now();
  try {
    await pool.query(
      `DELETE FROM projects p
        WHERE p.claim_token IS NOT NULL
          AND p.created_at < now() - interval '7 days'
          AND NOT EXISTS (SELECT 1 FROM events e WHERE e.project_id = p.id)`,
    );
  } catch (err) {
    logError("provision_reaper_failed", err);
  }
}

// Public, no auth: mints an ANONYMOUS project + a write-only client key so an
// agent can instrument a codebase with zero signup. The project has no members
// until a human opens the claimUrl and signs up to adopt it.
//
// Guardrails: strict per-IP rate limit here; the client key is ingestion-only
// (can't read data); unclaimed projects stop ingesting after 7 days (enforced
// in the event route) so abandoned/abuse keys self-disable.
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);

  // 10 anonymous projects per IP per hour (in-memory; resets on redeploy).
  const limit = rateLimit(`provision:${ip}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } },
    );
  }

  // Opportunistic cleanup of expired, never-used unclaimed projects.
  await reapExpiredUnclaimed();

  // Durable global backstop (survives redeploys — see comment above).
  try {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM projects
        WHERE claim_token IS NOT NULL AND created_at > now() - interval '1 hour'`,
    );
    if ((rows[0]?.c ?? 0) >= HOURLY_UNCLAIMED_CAP) {
      return NextResponse.json(
        { error: "Provisioning temporarily unavailable — try again later." },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }
  } catch (err) {
    // Fail open: the in-memory limiter above still applies.
    logError("provision_backstop_failed", err);
  }

  const claimToken = randomBytes(24).toString("hex");
  const [project] = await db
    .insert(projects)
    .values({
      name: "My App",
      apiKey: generateClientKey(),
      clientKey: generateClientKey(),
      serverKey: generateServerKey(),
      claimToken,
    })
    .returning();

  // Behind a proxy (Railway), request.nextUrl.origin is the internal bind
  // address (0.0.0.0:8080). Build the public origin from the forwarded headers.
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;
  const origin = `${proto}://${host}`;

  return NextResponse.json({
    clientKey: project.clientKey,
    claimUrl: `${origin}/claim/${claimToken}`,
    dashboardUrl: `${origin}/dashboards`,
  });
}
