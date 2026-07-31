/**
 * When each job should run.
 *
 * Deliberately not cron. A cron expression is a small language with its own
 * parser, its own timezone footguns and its own test surface, and what this
 * product needs is "every N minutes" and "once a day". An interval is a
 * number, and a number is testable.
 *
 * The scheduler is idempotent by construction: it computes a **key** from the
 * current time bucket and enqueues under it. Every replica computes the same
 * key, and the queue's unique index turns the second and third enqueue into a
 * no-op. There is no leader, no lock, and nothing to elect.
 */

import { Instant } from "@counted/domain";
import type { JobName } from "@counted/ports";

export type Schedule = {
  readonly name: JobName;
  /** How often it should run. */
  readonly everyMs: number;
  /**
   * How long one run may take before its claim lapses. Must exceed the
   * longest legitimate runtime, or two workers overlap by design rather than
   * by accident.
   */
  readonly leaseMs: number;
  /** Why this cadence, so the next person does not have to guess. */
  readonly why: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const SCHEDULES: readonly Schedule[] = [
  {
    name: "partitions.ensure",
    everyMs: HOUR,
    leaseMs: 5 * MINUTE,
    why: "Creating next month's partition must happen long before it is needed; an hourly check is free and the failure mode is ingestion stopping at midnight on the 1st.",
  },
  {
    name: "retention.purge",
    everyMs: 6 * HOUR,
    leaseMs: 30 * MINUTE,
    why: "Dropping an expired partition is instant, but the check walks every workspace's plan. Six-hourly keeps the promise without making it a busy loop.",
  },
  {
    name: "rollups.refresh",
    everyMs: 15 * MINUTE,
    leaseMs: 10 * MINUTE,
    why: "Dashboards read rollups; fifteen minutes is the staleness a customer will not notice against the cost of recomputing.",
  },
  {
    name: "monitors.evaluate",
    everyMs: MINUTE,
    leaseMs: 2 * MINUTE,
    why: "An alert that fires ten minutes late is an alert nobody trusts. v1 evaluated these from an HTTP endpoint guarded by a bearer secret in a query string.",
  },
  {
    name: "outbox.dispatch",
    everyMs: 10_000,
    leaseMs: MINUTE,
    why: "The gap between a change committing and its notification going out. Ten seconds is short enough to feel immediate and long enough to batch.",
  },
];

/**
 * The key for the bucket `at` falls in.
 *
 * Flooring to the interval is what makes every replica agree without talking:
 * they all compute the same bucket, so they all try to enqueue the same key,
 * and exactly one succeeds.
 */
export const bucketKey = (schedule: Schedule, at: Instant): string => {
  const millis = Instant.toEpochMillis(at);
  const bucket = Math.floor(millis / schedule.everyMs) * schedule.everyMs;
  return `${schedule.everyMs}:${bucket}`;
};

/** When the bucket containing `at` began. Jobs are due from then. */
export const bucketStart = (schedule: Schedule, at: Instant): Instant =>
  Instant.fromEpochMillis(Math.floor(Instant.toEpochMillis(at) / schedule.everyMs) * schedule.everyMs);
