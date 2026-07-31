/**
 * The composition root.
 *
 * This is the only file in the API that constructs an adapter. Everything else
 * receives what it needs. That is what makes the dependency rule mechanical
 * rather than aspirational: `dependency-cruiser` forbids the inner packages
 * from importing an adapter at all, and here — the one place allowed to — the
 * wiring is a dozen lines you can read in one sitting.
 *
 * Boot is deliberately fail-fast. The store is probed and the bucket contract
 * is verified against the live database; a disagreement throws and the process
 * does not start. v1 started happily on a host where its migration had failed
 * and every timeseries query threw at runtime, so users saw empty charts
 * instead of an outage.
 */

import { Pool } from "pg";
import {
  PostgresAnalyticalStore,
  PostgresEventWriter,
  PostgresUnitOfWork,
  bootStore,
  createAccessResolver,
  createQuotaService,
  describeBoot,
  poolConfig,
  type BootReport,
} from "@counted/adapter-postgres";
import { idGenerator, issueGrantToken, secretGenerator } from "@counted/adapter-crypto";
import { createLogger, type Logger } from "./http/log";
import type { AccessResolver, AnalyticalStore, EventWriter, GrantIssuer, IdGenerator, QuotaService, SecretGenerator } from "@counted/ports";
import { Coalescer } from "./ingest/coalescer";
import { Instant, type Clock } from "@counted/domain";

export type Config = {
  readonly databaseUrl: string;
  readonly port: number;
  /** Free-form, for the health payload. Not used for behaviour. */
  readonly release: string;
};

export const configFromEnv = (env: Record<string, string | undefined>): Config => {
  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    // Fail here rather than at the first query. A missing connection string is
    // a deployment mistake, and it should look like one.
    throw new Error("DATABASE_URL is required");
  }
  return {
    databaseUrl,
    port: Number(env["PORT"] ?? 8080),
    release: env["RELEASE"] ?? env["RAILWAY_GIT_COMMIT_SHA"] ?? "dev",
  };
};

/**
 * Everything the routes are allowed to touch. Deliberately an interface of
 * ports plus a clock — no pool, no driver, nothing a handler could use to
 * reach around the domain.
 */
export type Dependencies = {
  readonly store: AnalyticalStore;
  readonly writer: EventWriter;
  readonly unitOfWork: PostgresUnitOfWork;
  readonly clock: Clock;
  readonly access: AccessResolver;
  readonly log: Logger;
  readonly quota: QuotaService;
  /** Group commit. Every caller awaits its own batch. */
  readonly ingest: Coalescer;
  readonly secrets: SecretGenerator;
  readonly ids: IdGenerator;
  readonly grants: GrantIssuer;
  readonly boot: BootReport;
  readonly config: Config;
  shutdown(): Promise<void>;
};

/**
 * Wire the application.
 *
 * Two pools, because a slow dashboard must not be able to stop events being
 * written — v1 shared one pool of 20 between them, with no statement timeout.
 */
export const compose = async (config: Config): Promise<Dependencies> => {
  const analytics = new Pool(poolConfig(config.databaseUrl, "analytics"));
  const ingest = new Pool(poolConfig(config.databaseUrl, "ingest"));

  let boot: BootReport;
  try {
    // Probes capabilities and verifies that the database buckets exactly as
    // the domain does. Throws BucketContractViolation if not.
    boot = await bootStore(analytics);
  } catch (e) {
    await Promise.allSettled([analytics.end(), ingest.end()]);
    throw e;
  }

  const writer = new PostgresEventWriter(ingest);

  return {
    store: new PostgresAnalyticalStore(analytics, boot.capabilities),
    writer,
    // Group commit. Concurrent requests share one INSERT, and each awaits its
    // own batch's commit before it is answered.
    ingest: new Coalescer(writer),
    // Quota reads the ingest pool: it is on the ingest path, and a saturated
    // analytics pool must not be able to stop events being accepted.
    quota: createQuotaService(ingest),
    unitOfWork: new PostgresUnitOfWork(analytics),
    clock: { now: () => Instant.fromEpochMillis(Date.now()) },
    // Authorization reads the control plane, not the analytics pool: a slow
    // dashboard query must never be able to stop requests being authorized.
    access: createAccessResolver(analytics),
    log: createLogger({ service: "api", release: config.release }),
    secrets: secretGenerator,
    ids: idGenerator,
    grants: { issue: issueGrantToken },
    boot,
    config,
    shutdown: async () => {
      await Promise.allSettled([analytics.end(), ingest.end()]);
    },
  };
};

export const bootLine = (deps: Dependencies): string =>
  `counted-api release=${deps.config.release} port=${deps.config.port} ${describeBoot(deps.boot)}`;
