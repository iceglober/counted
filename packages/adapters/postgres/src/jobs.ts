/**
 * The job queue, in SQL.
 *
 * Three things make this safe to run on several replicas at once:
 *
 *   **`FOR UPDATE SKIP LOCKED`** on the claim. Two workers never take the same
 *   row: the second skips what the first has locked rather than blocking on it.
 *
 *   **A lease.** A claim expires. A worker that is killed mid-job — a deploy,
 *   an OOM — leaves its jobs claimed, and another worker picks them up once
 *   the lease lapses. Without this, one bad deploy strands work forever.
 *
 *   **A unique index** on `(name, key)`. Every replica can run the scheduler;
 *   only one job comes out. Not partial on "uncompleted" — a replica that
 *   enqueued, ran and completed a job within one tick would then leave nothing
 *   to conflict with, and the next replica would enqueue and run it again.
 *
 * The lease is also why every job must be idempotent. A lease can expire while
 * the work is still running — a long purge, a slow database — so a job *will*
 * eventually run twice. That is designed for rather than prevented.
 */

import type { Pool } from "pg";
import { Instant } from "@counted/domain";
import { JOB_NAMES, type ClaimOptions, type EnqueueRequest, type Job, type JobName, type JobOutcome, type JobQueue, type JobStats } from "@counted/ports";

type Row = {
  id: string;
  name: string;
  key: string;
  payload: unknown;
  run_after: Date;
  attempts: number;
};

/** A name we do not recognise is not a job. Better than dispatching to nothing. */
const isJobName = (raw: string): raw is JobName => (JOB_NAMES as readonly string[]).includes(raw);

const toJob = (row: Row): Job | null =>
  isJobName(row.name)
    ? {
        id: row.id,
        name: row.name,
        key: row.key,
        payload: (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as Record<string, unknown>,
        runAfter: Instant.fromEpochMillis(row.run_after.getTime()),
        attempts: row.attempts,
      }
    : null;

export type JobQueueOptions = {
  /** Past this many attempts a job stops being retried and is left failed. */
  readonly maxAttempts?: number;
  readonly newId?: () => string;
};

export const DEFAULT_MAX_ATTEMPTS = 8;

export const createJobQueue = (pool: Pool, options: JobQueueOptions = {}): JobQueue => {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const newId = options.newId ?? (() => crypto.randomUUID());

  return {
    async enqueue(request: EnqueueRequest): Promise<boolean> {
      // `DO NOTHING` against the unique index. No read-then-write, so two
      // replicas racing produce one row rather than a duplicate or an error.
      const { rowCount } = await pool.query(
        `INSERT INTO jobs (id, name, key, payload, run_after)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [newId(), request.name, request.key, JSON.stringify(request.payload ?? {}), Instant.toDate(request.runAfter)],
      );
      return (rowCount ?? 0) > 0;
    },

    async claim(claimOptions: ClaimOptions, at: Instant): Promise<readonly Job[]> {
      const now = Instant.toDate(at);
      const leaseCutoff = new Date(Instant.toEpochMillis(at) - claimOptions.leaseMs);

      // Sharding by a hash of the key rather than by row order, so adding a
      // replica redistributes work evenly instead of moving a boundary.
      const shardClause =
        claimOptions.shard === undefined
          ? ""
          : `AND (abs(hashtext(key)) % ${Math.max(1, claimOptions.shard.total)}) = ${claimOptions.shard.index}`;

      // Wrapped in a CTE so the *returned* order is defined. `UPDATE …
      // RETURNING` does not preserve the inner ORDER BY — PostgreSQL leaves
      // RETURNING order unspecified — so without the outer SELECT the right
      // jobs are claimed but handed back shuffled. That is invisible for most
      // jobs and wrong for the outbox, which should dispatch in the order
      // events occurred.
      const { rows } = await pool.query<Row>(
        `WITH claimed AS (
           UPDATE jobs SET claimed_at = $1, claimed_by = $2, attempts = attempts + 1
            WHERE id IN (
              SELECT id FROM jobs
               WHERE completed_at IS NULL
                 AND run_after <= $1
                 -- Unclaimed, or claimed by a worker whose lease has lapsed.
                 AND (claimed_at IS NULL OR claimed_at < $3)
                 ${shardClause}
               ORDER BY run_after
               LIMIT $4
               FOR UPDATE SKIP LOCKED
            )
            RETURNING id, name, key, payload, run_after, attempts
         )
         SELECT * FROM claimed ORDER BY run_after`,
        [now, claimOptions.worker, leaseCutoff, claimOptions.limit],
      );

      return rows.map(toJob).filter((job): job is Job => job !== null);
    },

    async settle(job: Job, outcome: JobOutcome, at: Instant, retryAfterMs: number): Promise<void> {
      if (outcome.kind !== "failed") {
        await pool.query(
          `UPDATE jobs SET completed_at = $2, outcome = $3, last_error = NULL, claimed_at = NULL WHERE id = $1`,
          [job.id, Instant.toDate(at), outcome.kind],
        );
        return;
      }

      const exhausted = !outcome.retryable || job.attempts >= maxAttempts;
      if (exhausted) {
        // Completed-as-failed rather than left pending: a job that can never
        // succeed must stop consuming claims. The next scheduled run is a
        // different key, so nothing is blocked by this row surviving.
        await pool.query(
          `UPDATE jobs SET completed_at = $2, outcome = 'failed', last_error = $3, claimed_at = NULL WHERE id = $1`,
          [job.id, Instant.toDate(at), outcome.error],
        );
        return;
      }

      await pool.query(
        `UPDATE jobs SET run_after = $2, last_error = $3, claimed_at = NULL, claimed_by = NULL WHERE id = $1`,
        [job.id, new Date(Instant.toEpochMillis(at) + retryAfterMs), outcome.error],
      );
    },

    async stats(at: Instant): Promise<JobStats> {
      const now = Instant.toDate(at);
      const { rows } = await pool.query<{ pending: string; due: string; stalled: string; failed: string }>(
        `SELECT
           count(*) FILTER (WHERE completed_at IS NULL)::text AS pending,
           count(*) FILTER (WHERE completed_at IS NULL AND run_after <= $1 AND claimed_at IS NULL)::text AS due,
           count(*) FILTER (WHERE completed_at IS NULL AND claimed_at < $2)::text AS stalled,
           count(*) FILTER (WHERE outcome = 'failed')::text AS failed
         FROM jobs`,
        [now, new Date(Instant.toEpochMillis(at) - 60_000)],
      );
      const row = rows[0];
      return {
        pending: Number(row?.pending ?? 0),
        due: Number(row?.due ?? 0),
        stalled: Number(row?.stalled ?? 0),
        failed: Number(row?.failed ?? 0),
      };
    },
  };
};
