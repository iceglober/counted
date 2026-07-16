import { db, pool } from "./db";
import { projectMembers, subscriptions } from "./db/schema";
import { and, eq } from "drizzle-orm";
import { PLANS } from "./stripe";

// Free-plan metering. PLANS.free declares 100K events/month; this module is the
// single place that actually counts against it. Reads are cached ~5 min so the
// ingest hot path never runs a COUNT per request.
//
// Over-quota semantics (the public "100K free" claim needs defined behavior):
//   • 0–100%   ingest normally.
//   • 100–130% keep ingesting (soft grace) — we do not silently drop the moment
//              a free user crosses their limit; we let them finish the month's
//              spike and prompt an upgrade.
//   • >130%    hard stop for free plans: the ingest route acknowledges (202) and
//              DROPS the event (no 429 retry storm). Pro plans are never hard-
//              stopped here.
// Retention purging is intentionally NOT implemented here (deferred until billing
// is live).

export type Plan = "free" | "pro";
export type UsageInfo = { used: number; limit: number; plan: Plan };

const CACHE_TTL_MS = 5 * 60 * 1000;
const FREE_GRACE_MULTIPLE = 1.3;

const usageCache = new Map<string, { value: UsageInfo; expiresAt: number }>();
const ownerCache = new Map<string, { userId: string | null; expiresAt: number }>();

/** First instant of the current calendar month, UTC. */
function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function resolvePlan(plan: string | undefined, status: string | undefined): Plan {
  return plan === "pro" && status === "active" ? "pro" : "free";
}

async function computeUsage(userId: string): Promise<UsageInfo> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  const plan = resolvePlan(sub?.plan, sub?.status);
  const limit = plan === "pro" ? PLANS.pro.events : PLANS.free.events;

  // Events across every project this user owns, this calendar month.
  const res = await pool.query(
    `SELECT COUNT(*)::bigint AS c
       FROM events e
       JOIN project_members pm ON pm.project_id = e.project_id
      WHERE pm.user_id = $1 AND pm.role = 'owner' AND e.timestamp >= $2`,
    [userId, monthStart()],
  );
  const used = Number(res.rows[0]?.c ?? 0);
  return { used, limit, plan };
}

/** Monthly usage for an owner, cached ~5 min. */
export async function getUsageForOwner(userId: string): Promise<UsageInfo> {
  const cached = usageCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await computeUsage(userId);
  usageCache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function getProjectOwner(projectId: string): Promise<string | null> {
  const cached = ownerCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;
  const m = await db.query.projectMembers.findFirst({
    where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "owner")),
  });
  const userId = m?.userId ?? null;
  ownerCache.set(projectId, { userId, expiresAt: Date.now() + CACHE_TTL_MS });
  return userId;
}

/**
 * True when a project's owner is on the free plan and has blown past the grace
 * multiple, so the ingest route should acknowledge-and-drop. Unclaimed/anonymous
 * projects (no owner) are never hard-stopped here. Cached, so this is cheap
 * enough to call on the ingest path.
 */
export async function isOverHardLimit(projectId: string): Promise<boolean> {
  const owner = await getProjectOwner(projectId);
  if (!owner) return false;
  const usage = await getUsageForOwner(owner);
  if (usage.plan !== "free") return false;
  return usage.used > usage.limit * FREE_GRACE_MULTIPLE;
}
