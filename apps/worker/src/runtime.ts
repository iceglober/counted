/**
 * The run loop.
 *
 * One tick does three things: enqueue whatever the schedule says is due, claim
 * a batch, and run each claimed job. Nothing about it assumes it is the only
 * worker — the queue's `SKIP LOCKED` claim and its lease are what make several
 * replicas safe, and the scheduler's bucket keys are what stop them each
 * enqueuing their own copy of the same job.
 *
 * A handler returns an outcome rather than throwing. A throw is caught and
 * treated as a retryable failure, because a job that dies on an unexpected
 * error should be retried, not lost — but a handler that *knows* something is
 * permanently wrong says so, and stops burning attempts.
 */

import { Instant, type Clock } from "@counted/domain";
import type { Job, JobName, JobOutcome, JobQueue, JobStats } from "@counted/ports";
import { SCHEDULES, bucketKey, bucketStart, type Schedule } from "./schedule";

export type Handler = (job: Job, context: HandlerContext) => Promise<JobOutcome>;

export type HandlerContext = {
  readonly now: Instant;
  readonly log: Logger;
  /** How long this job's claim is honoured. A handler doing long work should
   *  check this rather than assume it has forever. */
  readonly leaseMs: number;
};

export type Logger = {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
};

export type RuntimeOptions = {
  readonly queue: JobQueue;
  readonly clock: Clock;
  readonly log: Logger;
  readonly handlers: Readonly<Partial<Record<JobName, Handler>>>;
  /** Identifies this replica in `claimed_by`, so a stuck job is traceable. */
  readonly worker: string;
  readonly batchSize?: number;
  readonly schedules?: readonly Schedule[];
  /** Which slice of the queue this replica takes. Absent means all of it. */
  readonly shard?: { readonly index: number; readonly total: number };
  readonly maxAttempts?: number;
};

/**
 * Exponential with a ceiling, and jitter.
 *
 * Jitter because without it every job that failed in the same outage retries
 * in the same millisecond, which is how a recovering database gets knocked
 * over again by its own backlog.
 */
export const backoffMs = (attempts: number, random: () => number = Math.random): number => {
  const base = Math.min(30 * 60_000, 1_000 * 2 ** Math.min(attempts, 11));
  return Math.round(base * (0.5 + random() * 0.5));
};

export type TickReport = {
  readonly enqueued: number;
  readonly claimed: number;
  readonly done: number;
  readonly failed: number;
  readonly noop: number;
};

export class WorkerRuntime {
  private readonly schedules: readonly Schedule[];
  private readonly batchSize: number;
  private running = false;
  private stopping = false;

  constructor(private readonly options: RuntimeOptions) {
    this.schedules = options.schedules ?? SCHEDULES;
    this.batchSize = options.batchSize ?? 10;
  }

  /**
   * Enqueue everything the schedule says is due.
   *
   * Every replica calls this every tick. The bucket key makes all but one of
   * those a no-op, which is cheaper and far simpler than electing a leader.
   */
  async schedule(at: Instant): Promise<number> {
    let enqueued = 0;
    for (const schedule of this.schedules) {
      // A handler this worker cannot run must not be enqueued by it — that
      // would create work nothing will ever claim.
      if (this.options.handlers[schedule.name] === undefined) continue;

      const added = await this.options.queue.enqueue(
        {
          name: schedule.name,
          key: bucketKey(schedule, at),
          runAfter: bucketStart(schedule, at),
        },
        at,
      );
      if (added) enqueued += 1;
    }
    return enqueued;
  }

  /** Claim a batch and run it. Returns what happened, for the log and tests. */
  async runOnce(at: Instant = this.options.clock.now()): Promise<TickReport> {
    const enqueued = await this.schedule(at);

    // The lease is the longest any claimable job might need. Claiming with a
    // single lease keeps the query simple; a job that needs longer is told its
    // own lease through the context.
    const leaseMs = Math.max(...this.schedules.map((s) => s.leaseMs));
    const claimed = await this.options.queue.claim(
      {
        limit: this.batchSize,
        worker: this.options.worker,
        leaseMs,
        ...(this.options.shard === undefined ? {} : { shard: this.options.shard }),
      },
      at,
    );

    let done = 0;
    let failed = 0;
    let noop = 0;

    for (const job of claimed) {
      const outcome = await this.run(job, at);
      if (outcome.kind === "done") done += 1;
      else if (outcome.kind === "noop") noop += 1;
      else failed += 1;

      await this.options.queue.settle(job, outcome, this.options.clock.now(), backoffMs(job.attempts));
    }

    if (enqueued > 0 || claimed.length > 0) {
      this.options.log.info("worker.tick", { enqueued, claimed: claimed.length, done, failed, noop });
    }
    return { enqueued, claimed: claimed.length, done, failed, noop };
  }

  private async run(job: Job, at: Instant): Promise<JobOutcome> {
    const handler = this.options.handlers[job.name];
    if (handler === undefined) {
      // Enqueued by a replica that has this handler, claimed by one that does
      // not. Not retryable here: another worker will get it, and burning
      // attempts on this one would exhaust them.
      this.options.log.warn("job.unhandled", { job: job.name, id: job.id });
      return { kind: "failed", error: `no handler for ${job.name}`, retryable: true };
    }

    const schedule = this.schedules.find((s) => s.name === job.name);
    const startedAt = Date.now();

    try {
      const outcome = await handler(job, {
        now: at,
        log: this.options.log,
        leaseMs: schedule?.leaseMs ?? 60_000,
      });
      this.options.log.info("job.ran", {
        job: job.name,
        id: job.id,
        attempts: job.attempts,
        outcome: outcome.kind,
        durationMs: Date.now() - startedAt,
        ...(outcome.kind === "failed" ? { error: outcome.error } : {}),
      });
      return outcome;
    } catch (error) {
      // An unexpected throw is retryable. A handler that knows something is
      // permanently wrong returns `retryable: false` instead of throwing.
      const message = error instanceof Error ? error.message : "unknown error";
      this.options.log.error("job.threw", {
        job: job.name,
        id: job.id,
        attempts: job.attempts,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      return { kind: "failed", error: message, retryable: true };
    }
  }

  /** Loop until stopped. `sleep` is injected so tests do not wait. */
  async start(intervalMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
    this.running = true;
    this.stopping = false;
    while (!this.stopping) {
      try {
        await this.runOnce();
      } catch (error) {
        // The loop must survive anything — a database blip must not take the
        // worker down and leave the queue unattended.
        this.options.log.error("worker.tick_failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
      if (this.stopping) break;
      await sleep(intervalMs);
    }
    this.running = false;
  }

  /**
   * Stop after the current tick.
   *
   * Deliberately not mid-job: a job interrupted halfway is exactly what the
   * lease exists to recover, and letting the tick finish means most deploys
   * do not need that recovery at all.
   */
  stop(): void {
    this.stopping = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  stats(at: Instant): Promise<JobStats> {
    return this.options.queue.stats(at);
  }
}
