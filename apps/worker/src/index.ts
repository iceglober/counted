/**
 * @counted/worker — monitor evaluation, retention enforcement, the analytics
 * compactor, maintenance checks, outbox dispatch, and workspace reconciliation.
 *
 * Runs on the private network and is never reachable from the internet. Read
 * `main.ts` for the wiring and `worker.ts` for the schedule; each job in
 * `jobs/` is a plain function of its ports and an `Instant`, so the whole
 * schedule can be exercised with no database, no engine and no network.
 *
 * Exported so `main.ts` and the tests agree on one surface. Nothing outside
 * this app imports it — `apps-are-independent` forbids it, and there is nothing
 * here another deployable would want.
 */

export { readConfig, describeProblems, type ConfigProblem, type Env, type WorkerConfig } from "./config";
export { consoleLogger, recordingLogger, silentLogger, describeError } from "./logging";
export {
  analysisCodec,
  parseAnalysis,
  UnreadableAnalysisError,
} from "./analysis-codec";
export {
  engineObserver,
  fromEngineFailure,
  stepFor,
  type EngineObserverDeps,
  type Observation,
  type ScalarObserver,
} from "./observe";
export {
  scheduler,
  type Job,
  type JobReport,
  type Scheduler,
  type SchedulerDeps,
  type TickOutcome,
} from "./scheduler";
export {
  createWorker,
  workerJobs,
  MAINTENANCE_CHECK,
  MONITOR_SWEEP,
  OUTBOX_DISPATCH,
  RECONCILE,
  RETENTION_SWEEP,
  type WorkerDeps,
} from "./worker";

export { notificationsFor, sweepMonitors, type MonitorSweepDeps, type MonitorSweepReport } from "./jobs/monitors";
export {
  dispatchOutbox,
  type EnvelopeDispatcher,
  type OutboxDispatchDeps,
  type OutboxDispatchReport,
} from "./jobs/outbox";
export {
  enforceRetention,
  purgeFor,
  type RetentionSweepDeps,
  type RetentionSweepReport,
} from "./jobs/retention";
export {
  checkMaintenance,
  longestStoreRetentionDays,
  packFindings,
  retentionFindings,
  schemaFindings,
  shortestPlanRetentionDays,
  type Finding,
  type FindingKind,
  type MaintenanceDeps,
  type MaintenanceQueries,
  type MaintenanceReport,
} from "./jobs/maintenance";
export {
  reconcileWorkspaces,
  type ReconcileDeps,
  type ReconcileReport,
} from "./jobs/reconcile";

export { postgresRetentionTargets, type RetentionQueryable } from "./adapters/retention-targets";

export type {
  CompactorStatusSource,
  EventRetention,
  LogFields,
  Logger,
  OrganizationDirectory,
  OrganizationRecord,
  PurgeFailure,
  PurgeRequest,
  RetentionPage,
  RetentionTarget,
  RetentionTargets,
} from "./ports";
