/**
 * When each job runs, and what happens when one of them is slow.
 *
 * The scheduling policy is separated from the timer on purpose. `tick` is a
 * plain function of the current instant, so every property below is testable
 * without waiting for wall-clock time to pass — and the properties are the
 * whole reason this file exists rather than five `setInterval` calls.
 *
 * **A job that is still running is not started again.** This is the one that
 * matters. The monitor sweep claims monitors, evaluates them and sends mail; a
 * second copy running concurrently would evaluate the same monitors against the
 * same window and send the notification twice, and the cooldown would not save
 * it because both copies read the pre-update state. `setInterval` gives exactly
 * this behaviour the first time a sweep takes longer than its interval, and it
 * gives it silently.
 *
 * **A job that throws does not stop the schedule.** The error is logged against
 * the job's name and the next tick tries again. A background process where one
 * bad row ends all scheduling is a process that looks alive and does nothing.
 *
 * **Lateness does not accumulate.** The next run is due `every` after the last
 * one *finished*, not after it was due. A job that takes ninety seconds on a
 * sixty-second interval runs continuously rather than falling further behind a
 * queue of missed ticks that will never be caught up.
 */

import { Duration, Instant } from "@counted/kernel";
import type { Clock } from "@counted/kernel/ports";

import { describeError } from "./logging";
import type { LogFields, Logger } from "./ports";

/** What a job reports about a single run. Flat, because it becomes a log line. */
export type JobReport = LogFields;

export type Job = {
  readonly name: string;
  readonly every: Duration;
  run(at: Instant): Promise<JobReport>;
};

export type TickOutcome = {
  readonly started: readonly string[];
  /** Due, but the previous run has not finished. */
  readonly skipped: readonly string[];
};

export type SchedulerDeps = {
  readonly jobs: readonly Job[];
  readonly clock: Clock;
  readonly logger: Logger;
  /**
   * How often the scheduler wakes up to see what is due. Not how often a job
   * runs — that is each job's `every`. Finer than the shortest interval, or a
   * job runs late by up to one cadence.
   */
  readonly cadence?: Duration;
};

export type Scheduler = {
  /** Run everything that is due and not already running. Resolves when they all settle. */
  tick(at: Instant): Promise<TickOutcome>;
  start(): void;
  /** Stop waking up, then wait for whatever is in flight. */
  stop(): Promise<void>;
  /** Run one job now regardless of when it last ran. For a boot pass and for tests. */
  runNow(name: string, at: Instant): Promise<JobReport | null>;
  readonly running: boolean;
};

const DEFAULT_CADENCE = Duration.seconds(5);

export const scheduler = (deps: SchedulerDeps): Scheduler => {
  const inFlight = new Map<string, Promise<void>>();
  const lastFinished = new Map<string, Instant>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const byName = new Map(deps.jobs.map((job) => [job.name, job] as const));

  const due = (job: Job, at: Instant): boolean => {
    const last = lastFinished.get(job.name);
    if (last === undefined) return true;
    return Duration.compare(Instant.between(last, at), job.every) >= 0;
  };

  const invoke = async (job: Job, at: Instant): Promise<JobReport | null> => {
    const started = Date.now();
    try {
      const report = await job.run(at);
      deps.logger.info("job.ran", { job: job.name, ms: Date.now() - started, ...report });
      return report;
    } catch (cause) {
      deps.logger.error("job.failed", {
        job: job.name,
        ms: Date.now() - started,
        detail: describeError(cause),
      });
      return null;
    } finally {
      // Set from the clock, not from the wall, so a scripted clock in a test
      // and a real one in production schedule by the same rule.
      lastFinished.set(job.name, deps.clock.now());
      inFlight.delete(job.name);
    }
  };

  const launchReporting = (job: Job, at: Instant): Promise<JobReport | null> => {
    const work = invoke(job, at);
    inFlight.set(job.name, work.then(() => undefined));
    return work;
  };

  const launch = (job: Job, at: Instant): Promise<void> =>
    launchReporting(job, at).then(() => undefined);

  const tick = async (at: Instant): Promise<TickOutcome> => {
    const started: string[] = [];
    const skipped: string[] = [];
    const work: Promise<void>[] = [];

    for (const job of deps.jobs) {
      if (!due(job, at)) continue;
      if (inFlight.has(job.name)) {
        skipped.push(job.name);
        deps.logger.warn("job.overrun", { job: job.name });
        continue;
      }
      started.push(job.name);
      work.push(launch(job, at));
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
      const cadence = Duration.toMillis(deps.cadence ?? DEFAULT_CADENCE);
      timer = setInterval(() => {
        // Deliberately not awaited: the interval must keep firing while a job
        // runs, because that is what makes the overrun check above reachable.
        void tick(deps.clock.now());
      }, cadence);
      deps.logger.info("scheduler.started", {
        jobs: deps.jobs.map((job) => job.name).join(","),
        cadenceMs: cadence,
      });
    },

    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await Promise.all([...inFlight.values()]);
      deps.logger.info("scheduler.stopped");
    },

    async runNow(name: string, at: Instant): Promise<JobReport | null> {
      const job = byName.get(name);
      if (job === undefined) return null;
      const already = inFlight.get(name);
      if (already !== undefined) {
        await already;
        return null;
      }
      // `invoke` cannot reach its own `finally` before this returns: an async
      // function runs synchronously only up to its first await, and `launch`
      // registers the entry in that same synchronous stretch.
      return await launchReporting(job, at);
    },
  };
};
