/**
 * When each job runs, and what happens when one of them is slow.
 *
 * The scheduling policy is separated from the timer on purpose. `tick` is a
 * plain function of the current instant, so every property below is testable
 * without waiting for wall-clock time to pass.
 *
 * **A job that is still running is not started again.** Two packs racing in
 * one process would take the same tenant locks and skip each other, wasting
 * a tick; two maintenances would try to merge the same runs.
 *
 * **A job that throws does not stop the schedule.** The error is logged
 * against the job's name and the next tick tries again.
 *
 * **Lateness does not accumulate.** The next run is due `everyMs` after the
 * last one *finished*, not after it was due.
 *
 * **`runNow` during a run queues one follow-up.** A NOTIFY that arrives while
 * a pack is past its tenant scan must not be lost until the next tick, and
 * ten of them must not queue ten packs: the first queues a run that starts
 * after the current one finishes, the rest join it.
 */

import { describeError, type LogFields, type Logger } from "./logger.js";

export type JobReport = LogFields;

export type Job = {
  readonly name: string;
  readonly everyMs: number;
  run(nowMs: number): Promise<JobReport>;
};

export type TickOutcome = {
  readonly started: readonly string[];
  /** Due, but the previous run has not finished. */
  readonly skipped: readonly string[];
};

export type SchedulerDeps = {
  readonly jobs: readonly Job[];
  readonly logger: Logger;
  /** How often the scheduler wakes up to see what is due. Finer than the shortest `everyMs`. */
  readonly cadenceMs?: number;
  readonly now?: () => number;
};

export type Scheduler = {
  /** Run everything that is due and not already running. Resolves when they all settle. */
  tick(atMs: number): Promise<TickOutcome>;
  start(): void;
  /** Stop waking up, then wait for whatever is in flight. */
  stop(): Promise<void>;
  /**
   * Run one job now regardless of when it last ran. If a run is in flight, a
   * fresh run starts after it finishes (one, however many callers ask), so
   * the caller's reason for asking is always seen by a run that started
   * after the ask.
   */
  runNow(name: string): Promise<JobReport | null>;
  readonly running: boolean;
};

export const scheduler = (deps: SchedulerDeps): Scheduler => {
  const inFlight = new Map<string, Promise<JobReport | null>>();
  const queued = new Map<string, Promise<JobReport | null>>();
  const lastFinished = new Map<string, number>();
  const now = deps.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;
  const byName = new Map(deps.jobs.map((job) => [job.name, job] as const));

  const due = (job: Job, atMs: number): boolean => {
    const last = lastFinished.get(job.name);
    return last === undefined || atMs - last >= job.everyMs;
  };

  const invoke = async (job: Job, atMs: number): Promise<JobReport | null> => {
    const started = now();
    try {
      const report = await job.run(atMs);
      deps.logger.info("job.ran", { job: job.name, ms: now() - started, ...report });
      return report;
    } catch (cause) {
      deps.logger.error("job.failed", { job: job.name, ms: now() - started, detail: describeError(cause) });
      return null;
    } finally {
      lastFinished.set(job.name, now());
      inFlight.delete(job.name);
    }
  };

  const launch = (job: Job, atMs: number): Promise<JobReport | null> => {
    const work = invoke(job, atMs);
    inFlight.set(job.name, work);
    return work;
  };

  const tick = async (atMs: number): Promise<TickOutcome> => {
    const started: string[] = [];
    const skipped: string[] = [];
    const work: Promise<unknown>[] = [];
    for (const job of deps.jobs) {
      if (!due(job, atMs)) continue;
      if (inFlight.has(job.name)) {
        skipped.push(job.name);
        deps.logger.warn("job.overrun", { job: job.name });
        continue;
      }
      started.push(job.name);
      work.push(launch(job, atMs));
    }
    await Promise.all(work);
    return { started, skipped };
  };

  return {
    get running(): boolean {
      return timer !== null || inFlight.size > 0;
    },
    tick,
    start(): void {
      if (timer !== null) return;
      const cadenceMs = deps.cadenceMs ?? 1000;
      timer = setInterval(() => {
        // Deliberately not awaited: the interval must keep firing while a job
        // runs, because that is what makes the overrun check reachable.
        void tick(now());
      }, cadenceMs);
      deps.logger.info("scheduler.started", { jobs: deps.jobs.map((job) => job.name).join(","), cadenceMs });
    },
    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await Promise.all([...inFlight.values()]);
      deps.logger.info("scheduler.stopped");
    },
    async runNow(name: string): Promise<JobReport | null> {
      const job = byName.get(name);
      if (job === undefined) return null;
      const already = inFlight.get(name);
      if (already === undefined) return await launch(job, now());
      const follow = queued.get(name);
      if (follow !== undefined) return await follow;
      const next = already.then(() => {
        queued.delete(name);
        return launch(job, now());
      });
      queued.set(name, next);
      return await next;
    },
  };
};
