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
import { type LogFields, type Logger } from "./logger.js";
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
export declare const scheduler: (deps: SchedulerDeps) => Scheduler;
