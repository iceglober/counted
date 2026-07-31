/**
 * The worker's composition root.
 *
 * Same rule as the API's: this is the only file that constructs an adapter.
 * Handlers receive what they need and know nothing about pg.
 */

import { Pool } from "pg";
import { Instant, type Clock } from "@counted/domain";
import { createJobQueue, createPartitionMaintenance, createRetentionMaintenance, createRollupMaintenance, poolConfig, bootStore, PostgresAnalyticalStore, PostgresUnitOfWork } from "@counted/adapter-postgres";
import type { JobQueue } from "@counted/ports";
import { createNotifier } from "@counted/adapter-notify";
import type { Handler, Logger } from "./runtime";
import type { JobDependencies } from "./handlers";
import type { JobName } from "@counted/ports";

export type WorkerConfig = {
  readonly databaseUrl: string;
  readonly release: string;
  /** Identifies this replica. Railway supplies one; a hostname will do. */
  readonly workerId: string;
  readonly intervalMs: number;
  readonly shard: { readonly index: number; readonly total: number } | null;
  readonly notify: { readonly emailApiKey: string; readonly emailFrom: string; readonly webhookSecret: string };
};

export const configFromEnv = (env: Record<string, string | undefined>): WorkerConfig => {
  const databaseUrl = env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  const total = Number(env["WORKER_SHARDS"] ?? 1);
  const index = Number(env["WORKER_SHARD_INDEX"] ?? 0);
  // Sharding is opt-in. One replica taking everything is the right default,
  // and a misconfigured shard that silently claims nothing would be worse than
  // no sharding at all.
  const sharded = Number.isInteger(total) && total > 1 && Number.isInteger(index) && index >= 0 && index < total;

  return {
    databaseUrl,
    release: env["RELEASE"] ?? env["RAILWAY_GIT_COMMIT_SHA"] ?? "dev",
    workerId: env["RAILWAY_REPLICA_ID"] ?? env["HOSTNAME"] ?? `worker-${process.pid}`,
    intervalMs: Number(env["WORKER_INTERVAL_MS"] ?? 5_000),
    shard: sharded ? { index, total } : null,
    notify: {
      emailApiKey: env["RESEND_API_KEY"] ?? "",
      emailFrom: env["NOTIFY_FROM"] ?? "alerts@counted.dev",
      webhookSecret: env["WEBHOOK_SIGNING_SECRET"] ?? "",
    },
  };
};

export type WorkerDependencies = {
  readonly queue: JobQueue;
  readonly clock: Clock;
  readonly log: Logger;
  readonly handlers: Readonly<Partial<Record<JobName, Handler>>>;
  readonly config: WorkerConfig;
  shutdown(): Promise<void>;
};

export const compose = async (
  config: WorkerConfig,
  log: Logger,
  buildHandlers: (deps: JobDependencies) => Readonly<Partial<Record<JobName, Handler>>>,
): Promise<WorkerDependencies> => {
  const pool = new Pool(poolConfig(config.databaseUrl, "worker"));

  // The worker probes the store for the same reason the API does: a capability
  // it assumes and does not have is a query that throws at three in the
  // morning with nobody watching.
  const boot = await bootStore(pool);

  const handlers = buildHandlers({
    partitions: createPartitionMaintenance(pool),
    retention: createRetentionMaintenance(pool),
    rollups: createRollupMaintenance(pool),
    store: new PostgresAnalyticalStore(pool, boot.capabilities),
    unitOfWork: new PostgresUnitOfWork(pool),
    notifier: createNotifier({
      email: { apiKey: config.notify.emailApiKey, from: config.notify.emailFrom },
      webhook: { secret: config.notify.webhookSecret },
    }),
  });

  return {
    queue: createJobQueue(pool),
    clock: { now: () => Instant.fromEpochMillis(Date.now()) },
    log,
    handlers,
    config,
    shutdown: async () => {
      await pool.end();
    },
  };
};
