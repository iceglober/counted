/**
 * The worker's composition root: the only file that knows every concrete thing.
 *
 * It runs on the private network, is never reachable from the internet, and
 * exposes no port. Everything it does is on a schedule, which is why the boot
 * sequence ends by *saying* what it is going to run — a background process that
 * starts silently and then does four of its five jobs is indistinguishable from
 * one doing all five.
 *
 * The identity adapter supplies the organization directory used to repair
 * interrupted workspace provisioning. Deployments without identity report
 * reconciliation unavailable explicitly.
 *
 * This process also runs the analytics compactor: the loop that packs the
 * staging table into segments, merges small ones, applies retention and
 * vacuums. It is litics', bound here through the analytics adapter, and it
 * takes per-tenant advisory locks, so a second worker replica is safe.
 */

import { Pool } from "pg";
import { Resend } from "resend";

import { notifier, resendEmailSender, signedWebhookSender } from "@counted/adapter-notify";
import {
  applySchema,
  pooledRepositories,
  postgresUnitOfWork,
  noMemberships,
} from "@counted/adapter-postgres";
import {
  createLiticsCompactor,
  INDEXED_DIMENSIONS,
  LiticsAnalyticsEngine,
  LiticsEventRetention,
  PLANNED_DIMENSIONS,
  orgRemove,
  orgUpsert,
} from "@counted/analytics-adapter-litics";
import { Duration } from "@counted/kernel";
import { Analysis, DimensionCatalog } from "@counted/analytics-domain";
import { systemClock, uuidV7Generator } from "@counted/adapter-crypto";
import { err, Instant, isErr, ok } from "@counted/kernel";
import type { Notifier } from "@counted/kernel/ports";
import type { AnalysisCheck } from "@counted/dashboarding-app";

import { createIdentity } from "@counted/identity-adapter-better-auth";
import { grantableTo } from "@counted/projects-domain";
import { permissionsForRole } from "@counted/authorization";
import { AccountId, WorkspaceId } from "@counted/kernel";
import type { ProjectDependencies, ProjectRepositories } from "@counted/projects-app";
import type { UnitOfWork } from "@counted/persistence-ports";

import { analysisCodec } from "./analysis-codec";
import { consoleLogger, describeError } from "./logging";
import { describeProblems, readConfig } from "./config";
import { engineObserver } from "./observe";
import { postgresRecentProjects } from "./adapters/recent-projects";
import { postgresRetentionTargets } from "./adapters/retention-targets";
import { createWorker, workerJobs, MAINTENANCE_CHECK } from "./worker";
import type { EnvelopeDispatcher } from "./jobs/outbox";

/**
 * "This analysis produces one number a threshold can compare against."
 *
 * Supplied here because it is an analytics question that a dashboarding use
 * case cannot answer — `@counted/dashboarding-app` holds the analysis as an
 * opaque `A` and this is the layer allowed to know what `A` is. Structural
 * validity is checked first so an unrunnable analysis says *why* rather than
 * coming back as "not scalar".
 */
const isScalar: AnalysisCheck<Analysis> = (analysis) => {
  const valid = Analysis.validate(analysis);
  if (isErr(valid)) {
    return valid.error.kind === "InvalidAnalysis"
      ? err({ kind: "InvalidAnalysis", detail: valid.error.detail })
      : err({ kind: "InvalidAnalysis", detail: valid.error.kind });
  }
  return Analysis.isScalar(analysis) ? ok(analysis) : err({ kind: "AnalysisMustBeScalar" });
};

const main = async (): Promise<void> => {
  const logger = consoleLogger();

  const configured = readConfig(process.env);
  if (isErr(configured)) {
    // Written as plain text, not as a log object: this is the one message a
    // person reads directly, and a JSON blob of problems is worse to read than
    // a list of them.
    console.error(`the worker cannot start:\n${describeProblems(configured.error)}`);
    process.exit(1);
  }
  const config = configured.value;

  const pool = new Pool({ connectionString: config.databaseUrl });
  // Analytics reads on the direct host, and few of them: monitors evaluate
  // scalars one at a time. See the API's composition root for the reasoning.
  const analyticsPool = new Pool({ connectionString: config.databaseDirectUrl, max: 2 });
  const clock = systemClock;
  const ids = uuidV7Generator(clock);

  // Idempotent and lock-serialised, so a worker booting beside an API replica
  // waits rather than racing it through `CREATE TABLE IF NOT EXISTS`.
  await applySchema(pool);

  /**
   * The worker writes no workspace or project, so its repositories never place
   * one — but the option is required rather than optional, because a
   * deployment that omitted it would answer every analytics question with zero
   * and say nothing. `orgUpsert`/`orgRemove` are wired here anyway, so a job
   * that grows a write later is correct by default.
   */
  const tenancy = { place: orgUpsert, remove: orgRemove };
  const adapterOptions = { analysis: analysisCodec, memberships: noMemberships, tenancy };
  const repositories = pooledRepositories<Analysis>(pool, adapterOptions);
  const uow = postgresUnitOfWork<Analysis>(pool, adapterOptions);

  const engine = new LiticsAnalyticsEngine({ pool: analyticsPool, clock, cacheBytes: config.segmentCacheBytes });

  /**
   * The compactor, on the domain pool: packing is a write, and one at a time.
   * The listener wants a direct connection; `databaseDirectUrl` is that where
   * the operator set one, and the timer covers the case where it is really a
   * pooler.
   */
  const compactor = createLiticsCompactor({
    pool,
    listenUrl: config.databaseDirectUrl,
    logger,
    packIntervalMs: Duration.toMillis(config.pack.every),
    maintenanceIntervalMs: Duration.toMillis(config.pack.maintenanceEvery),
    maxStagingAgeMs: Duration.toMillis(config.pack.maxStagingAge),
  });
  const observe = engineObserver({
    engine,
    deadline: config.monitors.deadline,
    catalog: DimensionCatalog.of(INDEXED_DIMENSIONS, PLANNED_DIMENSIONS),
    ids,
  });

  const { emailFrom, resendApiKey, webhookSecret, outboxSink } = config.notifications;

  const email =
    resendApiKey !== null && emailFrom !== null
      ? resendEmailSender({ client: new Resend(resendApiKey), from: emailFrom })
      : null;
  const webhook =
    webhookSecret !== null ? signedWebhookSender({ secret: webhookSecret, clock }) : null;

  // Missing transports fail visibly and retain durable jobs for a later retry.
  const notify: Notifier = {
    deliver: async (notification) => {
      if (notification.channel === "email") {
        if (email === null) {
          throw new Error("Email delivery is unavailable: configure RESEND_API_KEY and COUNTED_MAIL_FROM.");
        }
        await email.send(notification);
        return;
      }
      if (webhook === null) {
        throw new Error("Webhook delivery is unavailable: configure COUNTED_WEBHOOK_SIGNING_SECRET.");
      }
      await webhook.send(notification);
    },
  };

  const dispatch: EnvelopeDispatcher | null =
    outboxSink !== null && webhook !== null
      ? async (envelope) => {
          await webhook.send({
            url: outboxSink,
            // The envelope's own id, so a redelivery is recognisable as one.
            id: envelope.id,
            payload: {
              id: envelope.id,
              type: envelope.type,
              occurredAt: Instant.toISO(envelope.occurredAt),
              payload: envelope.payload,
            },
          });
        }
      : null;

  /**
   * Identity, when this deployment was given the configuration for it.
   *
   * The worker never signs anybody in and never mounts better-auth's HTTP
   * surface. It builds an instance for one reason: the provisioning
   * reconciler has to read the `apikey` and `member` tables, and only this
   * adapter may. Without the configuration, `credentials` stays null and the
   * job says so rather than reporting a database it cannot see as healthy.
   *
   * On its own pool with `search_path=auth,public`, for the same reason
   * `apps/api` uses a second pool: better-auth 1.7 has no schema option and
   * creates and reads its tables unqualified, so a shared pool would look in
   * `public` and find nothing.
   */
  const identityConfig = config.identity;
  const identityPool =
    identityConfig === null
      ? null
      : new Pool({
          connectionString: config.databaseUrl,
          options: "-c search_path=auth,public",
        });
  const identity =
    identityConfig === null || identityPool === null
      ? null
      : createIdentity({
          baseURL: `${identityConfig.baseUrl}/api/auth`,
          secret: identityConfig.authSecret,
          database: { kind: "postgres", pool: identityPool },
          // The same composition `apps/api` supplies: one grant table, one
          // credential-kind ceiling. A worker that derived permissions
          // differently would issue repair keys the API would refuse.
          rolePermissions: permissionsForRole,
          grants: (kind, role) => {
            const grantable = grantableTo(kind, permissionsForRole(role));
            return grantable.ok ? grantable.value : [];
          },
          projects: {
            placementOf: async (project) => {
              const found = await repositories.projects.find(project);
              if (found === null) return null;
              return found.workspace === null
                ? { kind: "unclaimed" }
                : { kind: "claimed", workspace: found.workspace };
            },
          },
          holding: {
            workspace: WorkspaceId(identityConfig.holdingWorkspace),
            owner: AccountId(identityConfig.holdingOwner),
          },
          // The worker sends no magic links. A notifier is required, and this
          // one is the truthful implementation of "this process does not do
          // that" — it refuses rather than silently dropping a sign-in email.
          notifier: {
            deliver: async () => {
              throw new Error("worker: identity is read-only here and sends no mail");
            },
          },
          ids,
          mcpResource: `${identityConfig.baseUrl}/mcp`,
          log: (level, message, details) =>
            logger[level === "error" ? "error" : level === "warn" ? "warn" : "info"](
              `identity: ${message}`,
              { details: details.map(String).join(" ") },
            ),
        });

  /**
   * The projects context's dependencies, for the one use case the reconciler
   * runs. `uow` is the same unit of work: `CountedRepositories` carries the
   * project repository and the outbox, which is all `ProjectRepositories` is.
   */
  const projectUow: UnitOfWork<ProjectRepositories> = uow;
  const projectDeps: ProjectDependencies | null =
    identity === null
      ? null
      : { uow: projectUow, credentials: identity.credentials, clock, ids };

  const deps = {
    config,
    clock,
    logger,
    monitors: { monitors: repositories.monitors, clock, ids, isScalar },
    observe,
    notifier: notify,
    outbox: repositories.outbox,
    dispatch,
    targets: postgresRetentionTargets(pool),
    retention: new LiticsEventRetention({ pool }),
    maintenance: pool,
    compactor,
    organizations: identity?.organizations ?? null,
    workspaces: repositories.workspaces,
    uow,
    recentProjects: postgresRecentProjects(pool),
    credentials: identity?.credentials ?? null,
    memberships: identity?.memberships ?? null,
    projectDeps,
  };

  const worker = createWorker(deps);

  logger.info("worker.starting", {
    release: config.release,
    jobs: workerJobs(deps)
      .map((job) => job.name)
      .join(","),
    outboxSink: outboxSink !== null,
    email: email !== null,
    webhook: webhook !== null,
    reconcileRepair: config.reconcile.repair,
    identity: identity !== null,
  });

  // Runs once at boot rather than waiting up to fifteen minutes: the findings
  // are almost always about a deployment that has just changed.
  await compactor.start();
  await worker.runNow(MAINTENANCE_CHECK, clock.now());
  worker.start();

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info("worker.stopping", { signal });
    void Promise.all([worker.stop(), compactor.stop()])
      .then(() => Promise.all([pool.end(), analyticsPool.end()]))
      .catch((cause: unknown) => logger.error("worker.stop-failed", { detail: describeError(cause) }))
      .finally(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

await main();
