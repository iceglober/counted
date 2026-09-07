/**
 * The compactor: one object that packs, merges, applies retention and
 * migrates. Run it in your worker, or run `@litics/server`, which is this
 * plus an HTTP surface in a container.
 *
 *   const compactor = createCompactor(cfg, { pool, listen: { url: DIRECT_URL } });
 *   await compactor.migrate();
 *   await compactor.start();
 */

import { flush as flushCore, PACK_CHANNEL, type PackOutcome, type ResolvedConfig } from "@litics/core";
import type { Pool } from "pg";
import { listener as makeListener, type Listener } from "./listen.js";
import { consoleLogger, type Logger } from "./logger.js";
import { maintainAll, type MaintainReport } from "./maintain.js";
import { assertSchema, migrate as migrateCore, schemaDrift, type MigrateResult } from "./migrate.js";
import { packAll, type PackPolicy, type PackReport } from "./pack.js";
import { scheduler as makeScheduler, type Scheduler } from "./scheduler.js";

export type CompactorOptions = {
  pool: Pool;
  /** A direct (non-pooled) URL for LISTEN, or false to rely on the timer alone. Default false. */
  listen?: { url: string } | false;
  logger?: Logger;
  /** Timer cadence for the pack job. Default 5 s. */
  packIntervalMs?: number;
  /** Timer cadence for merge/retention/vacuum. Default 10 min. */
  maintenanceIntervalMs?: number;
  /** A partial segment is packed once its oldest row has waited this long. Default 60 s. */
  maxStagingAgeMs?: number;
  /** Rows with ts older than this go to the 'late' series. Default 1 h. */
  lateAfterMs?: number;
  /** Debounce for NOTIFY-triggered packs. Default 250 ms. */
  notifyDebounceMs?: number;
  now?: () => number;
};

export type StreamStatus = {
  stream: string;
  stagingRows: number;
  /** Age of the oldest staged row, or 0 when staging is empty. The lag metric. */
  oldestStagedMs: number;
  segments: number;
  packedEvents: number;
};

export type CompactorStatus = {
  running: boolean;
  listening: boolean;
  lastPackAt: number | null;
  lastMaintainAt: number | null;
  streams: StreamStatus[];
};

export type Compactor = {
  /** Apply migrations once, under the schema lock. */
  migrate(): Promise<MigrateResult>;
  assertSchema(): Promise<void>;
  schemaDrift(): Promise<string[]>;
  /** Start the timers and the listener. */
  start(): Promise<void>;
  /** Stop waking up; wait for in-flight work. */
  stop(): Promise<void>;
  /** One pack pass now (joins one already running). */
  pack(): Promise<PackReport>;
  /** One maintenance pass now. */
  maintain(): Promise<MaintainReport>;
  /** Pack everything in staging, however little — for tests and "make it current". */
  flush(stream?: string, tenant?: string): Promise<PackOutcome[]>;
  status(): Promise<CompactorStatus>;
};

export const PACK_JOB = "pack";
export const MAINTAIN_JOB = "maintain";

export const createCompactor = (cfg: ResolvedConfig, options: CompactorOptions): Compactor => {
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? Date.now;
  const policy: PackPolicy = {
    maxStagingAgeMs: options.maxStagingAgeMs ?? 60_000,
    lateAfterMs: options.lateAfterMs ?? 3_600_000,
  };
  let lastPackAt: number | null = null;
  let lastMaintainAt: number | null = null;
  let started = false;
  let listener: Listener | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const jobs: Scheduler = makeScheduler({
    logger,
    now,
    cadenceMs: Math.min(1000, options.packIntervalMs ?? 5000),
    jobs: [
      {
        name: PACK_JOB,
        everyMs: options.packIntervalMs ?? 5000,
        run: async (at) => {
          const report = await packAll(options.pool, cfg, policy, at, logger);
          lastPackAt = now();
          return report;
        },
      },
      {
        name: MAINTAIN_JOB,
        everyMs: options.maintenanceIntervalMs ?? 600_000,
        run: async () => {
          const report = await maintainAll(options.pool, cfg, logger);
          lastMaintainAt = now();
          return report;
        },
      },
    ],
  });

  const pack = async (): Promise<PackReport> => (await jobs.runNow(PACK_JOB)) as PackReport;
  const maintain = async (): Promise<MaintainReport> => (await jobs.runNow(MAINTAIN_JOB)) as MaintainReport;

  return {
    migrate: () => migrateCore(options.pool, cfg, { logger }),
    assertSchema: () => assertSchema(options.pool, cfg),
    schemaDrift: () => schemaDrift(options.pool, cfg),

    async start() {
      if (started) return;
      started = true;
      jobs.start();
      if (options.listen) {
        listener = makeListener({
          url: options.listen.url,
          channel: PACK_CHANNEL,
          logger,
          onNotify: () => {
            if (debounce !== null) return;
            debounce = setTimeout(() => {
              debounce = null;
              void pack();
            }, options.notifyDebounceMs ?? 250);
          },
        });
        await listener.start();
      }
      logger.info("compactor.started", { streams: cfg.streams.map((s) => s.name).join(","), listen: Boolean(options.listen) });
    },

    async stop() {
      if (!started) return;
      started = false;
      if (debounce !== null) {
        clearTimeout(debounce);
        debounce = null;
      }
      await listener?.stop();
      listener = null;
      await jobs.stop();
      logger.info("compactor.stopped");
    },

    pack,
    maintain,

    async flush(stream, tenant) {
      const streams = stream === undefined ? cfg.streams.map((s) => s.name) : [stream];
      const out: PackOutcome[] = [];
      for (const s of streams) out.push(...(await flushCore(options.pool, cfg, s, tenant)));
      return out;
    },

    async status() {
      const streams: StreamStatus[] = [];
      for (const st of cfg.streams) {
        const staging = await options.pool.query<{ rows: number; oldest_ms: string | null }>(
          `SELECT count(*)::int AS rows, (extract(epoch from (now() - min(staged_at))) * 1000)::int8::text AS oldest_ms FROM ${cfg.schema}.${st.name}`,
        );
        const segments = await options.pool.query<{ segments: number; events: string }>(
          `SELECT count(*)::int AS segments, coalesce(sum(n), 0)::text AS events FROM ${cfg.schema}.${st.name}_segments`,
        );
        streams.push({
          stream: st.name,
          stagingRows: staging.rows[0]!.rows,
          oldestStagedMs: staging.rows[0]!.oldest_ms === null ? 0 : Math.max(0, Number(staging.rows[0]!.oldest_ms)),
          segments: segments.rows[0]!.segments,
          packedEvents: Number(segments.rows[0]!.events),
        });
      }
      return { running: started, listening: listener?.connected ?? false, lastPackAt, lastMaintainAt, streams };
    },
  };
};
