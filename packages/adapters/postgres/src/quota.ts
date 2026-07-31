/**
 * Feeding the quota decision.
 *
 * The decision itself is `Quota.decide`, pure and in the domain. All this does
 * is look up the two facts it needs: what the workspace is entitled to, and
 * how many events it has recorded this period.
 *
 * **Cached, deliberately.** This runs on the ingest hot path, and a
 * month-wide `COUNT(*)` per request is not viable. But the cache is per
 * process and short, and — unlike v1's — it is only ever a *lower bound* on
 * usage: entries expire, and an over-quota workspace is recognised within the
 * TTL rather than within five minutes across N diverging replicas.
 *
 * v1 computed this with a month-wide count joined to `project_members` on
 * every ingest request, cached five minutes in a module-level `Map` with no
 * invalidation. With more than one replica the caches disagreed, so
 * enforcement was up to five minutes and N processes stale, and the usage a
 * customer saw changed depending on which replica answered.
 */

import type { Pool } from "pg";
import {
  Entitlement,
  Quota,
  type PaymentState,
  type PlanId,
  type ProjectId,
  type QuotaDecision,
} from "@counted/domain";
import type { QuotaService } from "@counted/ports";

/** Short enough that an over-quota workspace is caught quickly. */
export const QUOTA_TTL_MS = 30_000;

type Entry = { decision: QuotaDecision; expiresAt: number };

const PLANS: readonly string[] = ["free", "pro"];
const PAYMENTS: readonly string[] = ["none", "active", "past_due", "canceled"];

/**
 * An unrecognised plan or payment state falls back to free rather than
 * throwing or assuming pro. A typo in a column must not hand out a paid
 * allowance, and it must not stop ingestion either.
 */
const readPlan = (raw: unknown): PlanId => (typeof raw === "string" && PLANS.includes(raw) ? (raw as PlanId) : "free");
const readPayment = (raw: unknown): PaymentState =>
  typeof raw === "string" && PAYMENTS.includes(raw) ? (raw as PaymentState) : "none";

export type QuotaOptions = {
  readonly ttlMs?: number;
  readonly now?: () => number;
};

export const createQuotaService = (pool: Pool, options: QuotaOptions = {}): QuotaService => {
  const ttl = options.ttlMs ?? QUOTA_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, Entry>();

  return {
    async decide(project: ProjectId): Promise<QuotaDecision> {
      const cached = cache.get(project);
      if (cached !== undefined && cached.expiresAt > now()) return cached.decision;

      const { rows } = await pool.query<{ plan: string; payment_state: string; workspace_id: string | null }>(
        `SELECT w.plan, w.payment_state, p.workspace_id
           FROM projects p LEFT JOIN workspaces w ON w.id = p.workspace_id
          WHERE p.id = $1`,
        [project],
      );
      const row = rows[0];

      // An unclaimed project has no workspace and therefore no entitlement.
      // It gets the free allowance: it can be tried out before it is adopted,
      // which is the whole point of an unclaimed project.
      const entitlement =
        row === undefined || row.workspace_id === null
          ? Entitlement.none()
          : Entitlement.resolve(readPlan(row.plan), readPayment(row.payment_state));

      const used = await usageThisPeriod(pool, row?.workspace_id ?? null, project);
      const decision = Quota.decide(entitlement, { used });

      cache.set(project, { decision, expiresAt: now() + ttl });
      return decision;
    },
  };
};

/**
 * Events recorded by this workspace in the current calendar month.
 *
 * Counted across every project the workspace owns, because the allowance
 * belongs to the workspace. The month boundary is computed in SQL against
 * `date_trunc('month', now())`, so all replicas agree on where the period
 * starts without passing a clock around.
 *
 * The partition pruning makes this a scan of one monthly child table rather
 * than the whole history.
 */
const usageThisPeriod = async (pool: Pool, workspace: string | null, project: ProjectId): Promise<number> => {
  const { rows } =
    workspace === null
      ? await pool.query<{ used: string }>(
          `SELECT count(*)::text AS used FROM events
            WHERE project_id = $1 AND occurred_at >= date_trunc('month', now())`,
          [project],
        )
      : await pool.query<{ used: string }>(
          `SELECT count(*)::text AS used FROM events
            WHERE occurred_at >= date_trunc('month', now())
              AND project_id IN (SELECT id FROM projects WHERE workspace_id = $1)`,
          [workspace],
        );
  return Number(rows[0]?.used ?? 0);
};
