/**
 * Analytics maintenance is litics', and this is the handoff.
 *
 * Nothing in this file packs a segment, merges one or drops old data. The
 * compactor does that — `LiticsCompactor` in the analytics adapter, run by
 * this worker's `pack` and `segments` jobs — and litics declares the
 * retention in the analytics config. Reimplementing any of that here would
 * give the system two schedules for one job, which is how a segment gets
 * deleted twice and staging stops being packed with nobody noticing.
 *
 * What a worker can usefully do instead is **check that the handoff is
 * actually happening**, because every way it fails is silent:
 *
 *   - The config was edited after the migrations ran. Migrations do not re-run,
 *     so the engine reads columns that were never created, and the symptom is
 *     one filter combination erroring rather than anything that looks like a
 *     schema problem.
 *   - The store's retention and the pricing page's promise have drifted apart.
 *     That one needs no database at all, which is why it is checked first.
 *
 * Every check returns findings — sentences, with a machine-readable `kind` —
 * rather than throwing. A maintenance probe that crashes the worker on a
 * missing table has turned a warning into an outage.
 */

import {
  analyticsSchemaDrift,
  INTROSPECTION,
  SEGMENT_RETENTION_DAYS,
} from "@counted/analytics-adapter-litics";
import { longestRetentionDays, PLAN_IDS, PlanCatalog } from "@counted/tenancy-domain";

import { describeError } from "../logging";
import type { CompactorStatusSource } from "../ports";

export type FindingKind =
  /** The store drops data before the most generous plan says it will. */
  | "StoreKeepsLessThanPromised"
  /** The store keeps data past what some plan promises, so row purge is required. */
  | "RowPurgeRequired"
  | "SchemaDrift"
  /** Rows have waited in staging longer than the warning threshold: nothing is packing. */
  | "PackLagging"
  /** This process runs no compactor, so nothing packs unless another one does. */
  | "PackerUnwired"
  /** No EventRetention is wired, so the retention sweep deletes nothing. */
  | "PurgeUnwired"
  | "ProbeFailed";

export type Finding = {
  readonly kind: FindingKind;
  readonly detail: string;
};

/** The narrowest shape these probes need. A `pg.Pool` satisfies it. */
export interface MaintenanceQueries {
  query<R extends Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/** How long the analytics store keeps anything at all, in days. */
export const longestStoreRetentionDays = (): number => SEGMENT_RETENTION_DAYS;

/** The least generous plan's retention, or `null` if some plan keeps forever. */
export const shortestPlanRetentionDays = (): number | null => {
  let shortest: number | null = null;
  for (const id of PLAN_IDS) {
    const days = PlanCatalog.limitsFor(id).retentionDays;
    if (days === null) return null;
    shortest = shortest === null ? days : Math.min(shortest, days);
  }
  return shortest;
};

/**
 * Does what we keep match what we promised? No database required.
 *
 * Two directions and they are not symmetric. Keeping *less* than the most
 * generous plan promises is a broken promise to a paying customer and the store
 * cannot fix it retroactively — the rows are gone. Keeping *more* than the
 * least generous plan promises is the reason row-level purging has to exist at
 * all: segments are per project but retention is global, so a free-plan
 * project's segments outlive its plan's promise, and only a per-project delete
 * can honour the shorter one.
 */
export const retentionFindings = (): readonly Finding[] => {
  const findings: Finding[] = [];
  const store = longestStoreRetentionDays();
  const longestPlan = longestRetentionDays();
  const shortestPlan = shortestPlanRetentionDays();

  if (longestPlan === null || store < longestPlan) {
    findings.push({
      kind: "StoreKeepsLessThanPromised",
      detail:
        longestPlan === null
          ? `a plan promises to keep events indefinitely and the analytics store keeps ${store} days`
          : `the most generous plan promises ${longestPlan} days and the analytics store keeps ${store}`,
    });
  }

  if (shortestPlan !== null && store > shortestPlan) {
    findings.push({
      kind: "RowPurgeRequired",
      detail:
        `the least generous plan promises ${shortestPlan} days and the analytics store keeps ${store}; ` +
        `projects on that plan need row-level purging, which is jobs/retention.ts`,
    });
  }

  return findings;
};

/**
 * Config-versus-database drift, read through litics' own comparison.
 *
 * The introspection is deliberately unfiltered — it selects every column in the
 * schema and lets `diffSchema` decide what matters — because guessing which
 * tables are interesting is how an unrelated table ends up reported as a
 * missing one.
 */
export const schemaFindings = async (db: MaintenanceQueries): Promise<readonly Finding[]> => {
  try {
    const { rows } = await db.query<{ table: string; column: string; udt: string }>(
      INTROSPECTION.sql,
      [...INTROSPECTION.parameters],
    );
    return analyticsSchemaDrift(rows).map((detail) => ({ kind: "SchemaDrift" as const, detail }));
  } catch (cause) {
    return [{ kind: "ProbeFailed", detail: `schema introspection failed: ${describeError(cause)}` }];
  }
};

export type MaintenanceDeps = {
  /** `null` runs only the checks that need no database. */
  readonly db: MaintenanceQueries | null;
  /** The compactor this process runs, or `null` when it runs none. */
  readonly compactor?: CompactorStatusSource | null;
  /** Staging age past which packing is reported as lagging, in milliseconds. */
  readonly packLagWarnMs?: number;
  /** Whether an EventRetention is wired into the retention sweep. */
  readonly retentionWired?: boolean;
};

export type MaintenanceReport = {
  readonly findings: readonly Finding[];
  readonly probed: boolean;
};

/**
 * Is anything packing, and is it keeping up?
 *
 * A compactor that is absent and one that is stuck look the same from the
 * dashboard — reads stay correct, they just get slower as staging grows — so
 * both are findings. `oldestStagedMs` is the lag metric: how long the oldest
 * unpacked row has waited.
 */
export const packFindings = async (
  compactor: CompactorStatusSource | null,
  lagWarnMs: number,
): Promise<readonly Finding[]> => {
  if (compactor === null) {
    return [{ kind: "PackerUnwired", detail: "this worker runs no compactor; staging is packed only if another process does it" }];
  }
  try {
    const status = await compactor.status();
    return status.streams
      .filter((s) => s.stagingRows > 0 && s.oldestStagedMs > lagWarnMs)
      .map((s) => ({
        kind: "PackLagging" as const,
        detail:
          `${s.stream}: ${s.stagingRows} rows in staging, the oldest for ${Math.round(s.oldestStagedMs / 1000)}s` +
          `${status.listening ? "" : " (not listening for NOTIFY; timer only)"}`,
      }));
  } catch (cause) {
    return [{ kind: "ProbeFailed", detail: `compactor status failed: ${describeError(cause)}` }];
  }
};

export const checkMaintenance = async (deps: MaintenanceDeps): Promise<MaintenanceReport> => {
  const findings = [...retentionFindings()];
  if (deps.retentionWired === false) {
    findings.push({ kind: "PurgeUnwired", detail: "no EventRetention is wired; the retention sweep deletes nothing" });
  }
  if (deps.db === null) return { findings, probed: false };

  findings.push(...(await schemaFindings(deps.db)));
  findings.push(...(await packFindings(deps.compactor ?? null, deps.packLagWarnMs ?? 300_000)));
  return { findings, probed: true };
};
