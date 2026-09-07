/**
 * The ingest quota, derived from the events themselves.
 *
 * **There is no usage counter, deliberately.** A counter is a second answer to
 * a question the event store already answers, and the failure mode of a second
 * answer is drift that nothing reports. The period's count comes from one
 * workspace-scoped indexed read — litics aggregates a workspace across its whole
 * project subtree, so this is one query and not a fan-out.
 *
 * That read is far too expensive to do per request, so it is cached per
 * workspace for `refresh` and the events accepted since the last read are added
 * locally. The cache is what makes the hot path cheap; the local addition is
 * what makes a burst inside one refresh window still trip the limit. Without
 * the second half, a customer at 99% could send a million events in sixty
 * seconds and every one would be admitted.
 *
 * **A failed read admits the batch.** If the engine cannot say how much has
 * been used, refusing would take a customer's data away over an outage that is
 * ours; admitting it costs us the overage on one refresh window. The failure is
 * reported so it is not silent.
 *
 * `record` does not write anywhere. It advances the local count so the cached
 * reading stays honest until the next refresh, and that is all a derived quota
 * needs it to do.
 */

import { Duration, Instant, unbrand, type ProjectId, type WorkspaceId } from "@counted/kernel";
import type { AnalyticsEngine } from "@counted/analytics-ports";
import type { IngestQuota, QuotaVerdict } from "@counted/ingestion-app";
import { Entitlement, Quota } from "@counted/tenancy-domain";
import type { Logger } from "../logging";
import { DEFAULT_ADMISSION_POLICY } from "@counted/ingestion-domain";
import { eventsThisPeriod } from "../usage";

export type QuotaDeps = {
  readonly engine: AnalyticsEngine;
  /** The workspace a project belongs to; `null` while it is unclaimed. */
  projectWorkspace(project: ProjectId): Promise<WorkspaceId | null | undefined>;
  /** The workspace's plan standing, for the allowance. */
  workspaceEntitlement(workspace: WorkspaceId): Promise<Entitlement | null>;
  /** Bounds the provisional count, including permitted backdated events. */
  projectCreatedAt(project: ProjectId): Promise<Instant | null>;
  readonly logger: Logger;
  readonly deadline: Duration;
  /** How long a period reading is reused. Defaults to a minute. */
  readonly refresh?: Duration;
  /**
   * What an unclaimed project may send before it is claimed.
   *
   * Not unlimited: an unauthenticated provisioning endpoint whose keys have no
   * ceiling is free unlimited storage for anyone who can run `curl` in a loop.
   * Not zero either — the whole point of the no-signup path is that the first
   * event works.
   */
  readonly unclaimedAllowance?: number;
};

const DEFAULT_REFRESH = Duration.seconds(60);
const DEFAULT_UNCLAIMED_ALLOWANCE = 100_000;

type Reading = { used: number; readAt: Instant };

export const derivedIngestQuota = (deps: QuotaDeps): IngestQuota => {
  const refresh = deps.refresh ?? DEFAULT_REFRESH;
  const unclaimedAllowance = deps.unclaimedAllowance ?? DEFAULT_UNCLAIMED_ALLOWANCE;

  /** Per workspace, and per unclaimed project — those have no workspace. */
  const readings = new Map<string, Reading>();

  const stale = (reading: Reading, at: Instant): boolean =>
    Duration.compare(Instant.between(reading.readAt, at), refresh) >= 0;

  const usedBy = async (workspace: WorkspaceId, at: Instant): Promise<number | null> => {
    const key = unbrand(workspace);
    const cached = readings.get(key);
    if (cached !== undefined && !stale(cached, at)) return cached.used;

    const reading = await eventsThisPeriod(deps.engine, workspace, at, {
      deadline: deps.deadline,
      traceId: `quota:${key}`,
    });
    if (!reading.ok) {
      deps.logger.warn("quota reading failed; admitting the batch", {
        workspace: key,
        failure: reading.failure.kind,
      });
      return null;
    }
    readings.set(key, { used: reading.events, readAt: at });
    return reading.events;
  };

  const unclaimedUsedBy = async (project: ProjectId, at: Instant): Promise<number | null> => {
    const key = `unclaimed:${unbrand(project)}`;
    const cached = readings.get(key);
    if (cached !== undefined && !stale(cached, at)) return cached.used;
    const createdAt = await deps.projectCreatedAt(project);
    if (createdAt === null) return null;
    const reading = await deps.engine.counts({
      scope: {level: "project", project},
      bounds: {
        from: Instant.minus(createdAt, DEFAULT_ADMISSION_POLICY.maxAge),
        to: Instant.plus(at, Duration.add(DEFAULT_ADMISSION_POLICY.maxFutureSkew, Duration.millis(1))),
      },
      step: "day",
    }, {deadline: deps.deadline, traceId: `quota:${key}`});
    if (!reading.ok) {
      deps.logger.warn("quota reading failed; admitting the batch", {project: unbrand(project),failure: reading.error.kind});
      return null;
    }
    const used = reading.value.buckets.reduce((sum,bucket) => sum+bucket.value,0);
    readings.set(key,{used,readAt:at});
    return used;
  };

  return {
    async check(project: ProjectId, count: number, at: Instant): Promise<QuotaVerdict> {
      const workspace = await deps.projectWorkspace(project);
      if (workspace === undefined) {
        // No such project. The credential named it, so this is a project that
        // was deleted between issuance and now; refusing as `PlanExceeded`
        // would say the wrong thing, so it is rate-limited with a long backoff
        // — the honest instruction being "stop sending".
        return { kind: "RateLimited", retryAfter: Duration.hours(1) };
      }

      if (workspace === null) {
        const prior = await unclaimedUsedBy(project, at);
        if (prior === null) return {kind: "Allowed", remaining: null};
        const used = prior + count;
        return used > unclaimedAllowance
          ? { kind: "PlanExceeded", limit: unclaimedAllowance, used }
          : { kind: "Allowed", remaining: unclaimedAllowance - used };
      }

      const entitlement = await deps.workspaceEntitlement(workspace);
      if (entitlement === null) return { kind: "Allowed", remaining: null };

      // An unlimited allowance has nothing to compare against, so the reading
      // is not taken at all. Reading it anyway would put an analytics query on the
      // hot path of the customers who pay us not to have one.
      if (entitlement.limits.eventsPerMonth === null) {
        return { kind: "Allowed", remaining: null };
      }

      const used = await usedBy(workspace, at);
      if (used === null) return { kind: "Allowed", remaining: null };

      const decision = Quota.decide(entitlement, { used: used + count });
      if (decision.kind === "rejected") {
        return { kind: "PlanExceeded", limit: decision.limit, used: decision.used };
      }
      // `overage` still accepts. Cutting a customer off at exactly 100%
      // mid-month loses data over a rounding error; the band is the domain's.
      return {
        kind: "Allowed",
        remaining: decision.limit === null ? null : Math.max(0, decision.limit - decision.used),
      };
    },

    async record(workspace: WorkspaceId, count: number, _at: Instant, project: ProjectId): Promise<void> {
      // GroupCommit supplies the durable receipt's newly written count. Both
      // keys are safe to update: only a scope previously read has a cache.
      for (const key of [unbrand(workspace), `unclaimed:${unbrand(project)}`]) {
        const cached = readings.get(key);
        if (cached !== undefined) readings.set(key, {used: cached.used + count, readAt: cached.readAt});
      }
    },
  };
};
