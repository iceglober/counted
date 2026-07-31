/**
 * The worker process.
 *
 * Starts the loop, and stops it cleanly on SIGTERM: the current tick finishes
 * and its jobs are settled before the process exits. A job interrupted halfway
 * is what the lease exists to recover, but a deploy should not need that
 * recovery for work that was nearly done.
 */

import { compose, configFromEnv } from "./composition";
import { WorkerRuntime } from "./runtime";
import { handlers } from "./handlers";

const log = {
  write: (level: string, event: string, fields: Record<string, unknown> = {}) => {
    process.stdout.write(
      `${JSON.stringify({ level, event, ts: new Date().toISOString(), service: "worker", ...fields })}\n`,
    );
  },
  info: (event: string, fields?: Record<string, unknown>) => log.write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log.write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log.write("error", event, fields),
};

const config = configFromEnv(process.env);
const deps = await compose(config, log, handlers);

const runtime = new WorkerRuntime({
  queue: deps.queue,
  clock: deps.clock,
  log,
  handlers: deps.handlers,
  worker: config.workerId,
  ...(config.shard === null ? {} : { shard: config.shard }),
});

log.info("worker.started", {
  release: config.release,
  workerId: config.workerId,
  intervalMs: config.intervalMs,
  shard: config.shard,
  jobs: Object.keys(deps.handlers),
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("worker.stopping", { signal });
  runtime.stop();
  // Give the current tick a moment to settle its jobs before the pool closes.
  while (runtime.isRunning()) await sleep(50);
  await deps.shutdown();
  log.info("worker.stopped", {});
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await runtime.start(config.intervalMs, sleep);
