/**
 * The six jobs, and how each one's report becomes a log line.
 *
 * Assembling them is separate from wiring them (`main.ts`) so the whole
 * schedule can be exercised against fakes: `workerJobs` takes only interfaces,
 * so a test can drive a full tick with no database, no engine and no network.
 *
 * Each job's typed report is flattened here rather than in the job, because the
 * flat shape exists for one consumer — the log line — and a job that returned
 * `Record<string, number>` could not be asserted on precisely in its own tests.
 */

import type { MonitorDeps } from "@counted/dashboarding-app";
import type { ProvisionWorkspaceDeps, WorkspaceRepository } from "@counted/tenancy-app";
import { Duration, type Instant } from "@counted/kernel";
import type { Clock, Notifier } from "@counted/kernel/ports";
import type { Outbox, UnitOfWork } from "@counted/persistence-ports";

import type { WorkerConfig } from "./config";
import type { ScalarObserver } from "./observe";
import { checkMaintenance, type MaintenanceQueries } from "./jobs/maintenance";
import { dispatchOutbox, type EnvelopeDispatcher } from "./jobs/outbox";
import { enforceRetention } from "./jobs/retention";
import { reconcileWorkspaces } from "./jobs/reconcile";
import { reconcileProvisioning } from "./jobs/provisioning";
import { sweepMonitors } from "./jobs/monitors";
import { scheduler, type Job, type JobReport, type Scheduler } from "./scheduler";
import type {
  CompactorStatusSource,
  EventRetention,
  Logger,
  OrganizationDirectory,
  RecentProjects,
  RetentionTargets,
} from "./ports";
import type { CredentialStore, MembershipDirectory } from "@counted/identity-ports";
import type { ProjectDependencies } from "@counted/projects-app";

export type WorkerDeps<A> = {
  readonly config: WorkerConfig;
  readonly clock: Clock;
  readonly logger: Logger;

  readonly monitors: MonitorDeps<A>;
  readonly observe: ScalarObserver<A>;
  readonly notifier: Notifier;

  readonly outbox: Outbox;
  /**
   * `null` when no sink is configured. The dispatch job is then not registered
   * at all, and envelopes accumulate in a table somebody can look at — which is
   * the recoverable direction. A dispatcher that marked them delivered to
   * nowhere would drop them silently and permanently.
   */
  readonly dispatch: EnvelopeDispatcher | null;

  readonly targets: RetentionTargets;
  readonly retention: EventRetention | null;

  /** `null` runs the maintenance checks that need no database. */
  readonly maintenance: MaintenanceQueries | null;
  /**
   * The compactor this process runs, for the lag check. `null` when it runs
   * none — reported as a finding, because reads then depend on some other
   * process packing.
   */
  readonly compactor: CompactorStatusSource | null;

  readonly organizations: OrganizationDirectory | null;
  readonly workspaces: WorkspaceRepository;
  readonly uow: UnitOfWork<ProvisionWorkspaceDeps>;

  /** Recently created projects, for the provisioning reconciler. */
  readonly recentProjects: RecentProjects;
  /**
   * The three identity-shaped things the provisioning reconciler needs, all
   * `null` together when this process was not given an identity configuration.
   * The job then reports `unavailable` rather than scanning nothing and
   * calling every project healthy.
   */
  readonly credentials: CredentialStore | null;
  readonly memberships: MembershipDirectory | null;
  readonly projectDeps: ProjectDependencies | null;
};

export const MONITOR_SWEEP = "monitors";
export const OUTBOX_DISPATCH = "outbox";
export const RETENTION_SWEEP = "retention";
export const MAINTENANCE_CHECK = "maintenance";
export const RECONCILE = "reconcile";
export const PROVISIONING = "provisioning";

export const workerJobs = <A>(deps: WorkerDeps<A>): readonly Job[] => {
  const { config } = deps;
  const dispatch = deps.dispatch;

  const jobs: Job[] = [
    {
      name: MONITOR_SWEEP,
      every: config.monitors.every,
      run: async (at: Instant): Promise<JobReport> => ({
        ...(await sweepMonitors(
          {
            monitors: deps.monitors,
            observe: deps.observe,
            notifier: deps.notifier,
            logger: deps.logger,
            batch: config.monitors.batch,
          },
          at,
        )),
      }),
    },
    {
      name: RETENTION_SWEEP,
      every: config.retention.every,
      run: async (at: Instant): Promise<JobReport> => {
        const report = await enforceRetention(
          {
            targets: deps.targets,
            retention: deps.retention,
            logger: deps.logger,
            pageSize: config.retention.pageSize,
            maxProjects: config.retention.maxProjects,
          },
          at,
        );
        return report.kind === "unavailable"
          ? { available: false, missing: report.missing }
          : { available: true, ...report };
      },
    },
    {
      name: MAINTENANCE_CHECK,
      every: config.maintenance.every,
      run: async (): Promise<JobReport> => {
        const report = await checkMaintenance({
          db: deps.maintenance,
          compactor: deps.compactor,
          packLagWarnMs: Duration.toMillis(config.pack.lagWarn),
          retentionWired: deps.retention !== null,
        });
        for (const finding of report.findings) {
          // Every finding is a warning and none is an error: all of them mean
          // "something upstream is not doing its job", and none of them is
          // something this process can fix or should exit over.
          deps.logger.warn("maintenance.finding", { kind: finding.kind, detail: finding.detail });
        }
        return { probed: report.probed, findings: report.findings.length };
      },
    },
    {
      name: RECONCILE,
      every: config.reconcile.every,
      run: async (at: Instant): Promise<JobReport> => {
        const report = await reconcileWorkspaces(
          {
            organizations: deps.organizations,
            workspaces: deps.workspaces,
            uow: deps.uow,
            logger: deps.logger,
            lookback: config.reconcile.lookback,
            batch: config.reconcile.batch,
            repair: config.reconcile.repair,
          },
          at,
        );
        return report.kind === "unavailable"
          ? { available: false, missing: report.missing }
          : { available: true, ...report };
      },
    },
    {
      name: PROVISIONING,
      every: config.reconcile.every,
      run: async (at: Instant): Promise<JobReport> => {
        const report = await reconcileProvisioning(
          {
            projects: deps.recentProjects,
            credentials: deps.credentials,
            memberships: deps.memberships,
            projectDeps: deps.projectDeps,
            logger: deps.logger,
            lookback: config.reconcile.lookback,
            batch: config.reconcile.batch,
            repair: config.reconcile.repair,
          },
          at,
        );
        return report.kind === "unavailable"
          ? { available: false, missing: report.missing }
          : { available: true, ...report };
      },
    },
  ];

  if (dispatch !== null) {
    jobs.push({
      name: OUTBOX_DISPATCH,
      every: config.outbox.every,
      run: async (at: Instant): Promise<JobReport> => ({
        ...(await dispatchOutbox(
          {
            outbox: deps.outbox,
            dispatch,
            logger: deps.logger,
            batch: config.outbox.batch,
            maxAttempts: config.outbox.maxAttempts,
          },
          at,
        )),
      }),
    });
  }

  return jobs;
};

export const createWorker = <A>(deps: WorkerDeps<A>): Scheduler =>
  scheduler({
    jobs: workerJobs(deps),
    clock: deps.clock,
    logger: deps.logger,
    cadence: deps.config.cadence,
  });
