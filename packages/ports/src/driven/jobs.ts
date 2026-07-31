/**
 * Background work.
 *
 * The worker exists because three things the product advertises are impossible
 * without one: retention purging, rollups, and evaluating alerts without
 * blocking a request. v1 had no worker, so retention was never implemented at
 * all and alerts were evaluated by an HTTP endpoint guarded by a bearer secret
 * in a query string.
 *
 * Two properties everything here is built around:
 *
 *   **Claiming is safe with several replicas.** `FOR UPDATE SKIP LOCKED` means
 *   two workers never take the same job, and a lease means a worker that dies
 *   mid-job does not strand it.
 *
 *   **Every job is idempotent.** Not as a convention but as a requirement: a
 *   lease can expire while work is still running, so a job *will* eventually
 *   run twice. Designing for that is cheaper than trying to prevent it.
 */

import type { Instant } from "@counted/domain";

/** Names are a closed set so a typo cannot silently enqueue nothing. */
export type JobName =
  | "partitions.ensure"
  | "retention.purge"
  | "rollups.refresh"
  | "monitors.evaluate"
  | "outbox.dispatch";

export const JOB_NAMES: readonly JobName[] = [
  "partitions.ensure",
  "retention.purge",
  "rollups.refresh",
  "monitors.evaluate",
  "outbox.dispatch",
];

export type Job = {
  readonly id: string;
  readonly name: JobName;
  /**
   * Deduplicates. At most one uncompleted job exists per (name, key), so a
   * scheduler that runs on every replica enqueues one job, not one per replica.
   */
  readonly key: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runAfter: Instant;
  /** How many times this has been claimed, including the current attempt. */
  readonly attempts: number;
};

export type JobOutcome =
  | { readonly kind: "done"; readonly detail?: string }
  /** Ran, found nothing to do. Distinguished so the logs are readable. */
  | { readonly kind: "noop"; readonly detail?: string }
  /** Failed; retry after the backoff unless attempts are exhausted. */
  | { readonly kind: "failed"; readonly error: string; readonly retryable: boolean };

export type EnqueueRequest = {
  readonly name: JobName;
  readonly key: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly runAfter: Instant;
};

export type ClaimOptions = {
  readonly limit: number;
  /** Identifies the claimant, so a stuck job can be traced to a replica. */
  readonly worker: string;
  /**
   * How long a claim is honoured before another worker may take it. Must
   * exceed the longest a job can legitimately run, or two workers overlap on
   * purpose rather than by accident.
   */
  readonly leaseMs: number;
  /**
   * Only claim jobs whose key hashes into this shard. Absent means all of
   * them. Lets several replicas divide fan-out work without coordinating.
   */
  readonly shard?: { readonly index: number; readonly total: number };
};

export interface JobQueue {
  /**
   * Add a job unless an uncompleted one with the same (name, key) exists.
   * Returns false when it already did, which is the normal case for a
   * scheduler running on every replica.
   */
  enqueue(request: EnqueueRequest, at: Instant): Promise<boolean>;

  /** Take up to `limit` due jobs, marking them claimed. */
  claim(options: ClaimOptions, at: Instant): Promise<readonly Job[]>;

  /** Record the outcome: completed, or scheduled for another attempt. */
  settle(job: Job, outcome: JobOutcome, at: Instant, retryAfterMs: number): Promise<void>;

  /** For readiness and for a "why is nothing running" question. */
  stats(at: Instant): Promise<JobStats>;
}

export type JobStats = {
  readonly pending: number;
  /** Due but unclaimed. Growing means the workers cannot keep up. */
  readonly due: number;
  /** Claimed with an expired lease — a worker died holding these. */
  readonly stalled: number;
  readonly failed: number;
};

/**
 * Maintaining the event table's partitions.
 *
 * Separate from the job queue because it is a different concern with a
 * different failure mode: the queue losing a job is an inconvenience, and
 * partitions falling behind is ingestion stopping at midnight on the 1st.
 */
export interface PartitionMaintenance {
  /** What the database actually has, parsed back into bounds. */
  list(): Promise<readonly PartitionSpec[]>;
  /** Idempotent — `CREATE TABLE IF NOT EXISTS`. */
  create(spec: PartitionSpec): Promise<void>;
  /**
   * How many rows are sitting in the default partition.
   *
   * Non-zero means partition creation fell behind and events were written
   * outside every month we had made. They are not lost, but they are not
   * pruned by retention either, and no query that relies on partition pruning
   * will be fast.
   */
  countDefault(): Promise<number>;
  /**
   * Move rows out of the default partition into the month they belong to.
   *
   * Returns how many moved. Bounded per call so one enormous backlog does not
   * hold a transaction open for an hour.
   */
  drainDefault(limit: number): Promise<number>;
}

export type PartitionSpec = {
  readonly name: string;
  readonly from: Instant;
  readonly to: Instant;
};

/**
 * Deleting events past their retention.
 *
 * Two mechanisms because partitions are global and retention is per-plan: a
 * whole month can only be dropped once it is expired for *everyone*, and
 * anything shorter has to be deleted per project inside partitions other
 * customers still need.
 */
export interface RetentionMaintenance {
  /**
   * Irreversible. The caller must have established that the partition's entire
   * range is past the longest retention any plan grants.
   */
  dropPartition(name: string): Promise<void>;

  /**
   * Every project, with the plan and payment state that govern its retention.
   *
   * Read together rather than per project, because the alternative is a query
   * per project on a job that runs every six hours.
   */
  projectsWithPlans(): Promise<readonly ProjectRetention[]>;

  /**
   * Delete a project's events older than `olderThan`, up to `limit` rows.
   * Returns how many were deleted, so the caller can tell "done" from "more".
   */
  purgeProject(project: import("@counted/domain").ProjectId, olderThan: import("@counted/domain").Instant, limit: number): Promise<number>;
}

export type ProjectRetention = {
  readonly project: import("@counted/domain").ProjectId;
  readonly plan: string;
  readonly payment: string;
};

/**
 * Maintaining the daily rollups.
 *
 * A rollup is a second representation of data that already exists, so the only
 * property that really matters is that it cannot disagree with the source.
 * Which is why the refresh recomputes whole buckets rather than incrementing
 * them, and why the dirty set is decided by ingestion time rather than by "the
 * last few days" — an event backdated ninety days dirties the bucket it
 * belongs to, not the one it arrived in.
 */
export interface RollupMaintenance {
  /** Where the last refresh got to, by ingestion time. Null when never run. */
  watermark(): Promise<import("@counted/domain").Instant | null>;

  /**
   * Recompute every daily bucket touched by events ingested in `(from, to]`.
   *
   * Returns how many buckets were rewritten. Recomputing rather than
   * incrementing means running it twice over the same window is a no-op, which
   * is what makes it safe under the worker's lease.
   */
  refresh(
    from: import("@counted/domain").Instant | null,
    to: import("@counted/domain").Instant,
  ): Promise<number>;

  /** Advance the watermark. Separate, so it only moves after a refresh lands. */
  commitWatermark(to: import("@counted/domain").Instant): Promise<void>;

  /** Read back a project's daily counts. What a dashboard would use. */
  dailyCounts(
    project: import("@counted/domain").ProjectId,
    from: import("@counted/domain").Instant,
    to: import("@counted/domain").Instant,
  ): Promise<readonly RollupRow[]>;
}

export type RollupRow = {
  readonly day: string;
  readonly name: string;
  readonly events: number;
  readonly visits: number;
  readonly people: number;
};
