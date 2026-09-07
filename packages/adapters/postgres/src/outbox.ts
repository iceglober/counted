/**
 * The outbox over Postgres.
 *
 * Events are written in the same transaction as the aggregate that produced
 * them and dispatched later by the worker. That is what makes "the change
 * happened but the email did not" a recoverable state rather than a lost one —
 * and it only works because better-auth, the domain and litics share one
 * database, so "in the same transaction" is always available.
 *
 * **`claim` is `FOR UPDATE SKIP LOCKED`.** Two workers running the sweep at the
 * same time must not both take the same row: with a plain `SELECT` they would,
 * and the customer gets two of every notification. `SKIP LOCKED` makes the
 * second worker walk past the rows the first has already locked instead of
 * blocking behind them, so adding a worker adds throughput rather than
 * contention.
 *
 * **`claimed_at` is a lease, not a flag.** A worker that dies between claiming
 * and dispatching would otherwise hold its rows forever, and the events nobody
 * ever sees are exactly the ones nobody notices are missing. After
 * `leaseSeconds` a claimed-but-undispatched row becomes claimable again. The
 * consequence is at-least-once delivery, which is why an envelope's `id` is
 * stable across redeliveries and travels as `webhook-id` — the receiver
 * deduplicates.
 */

import { Instant, type DomainEvent, type EventEnvelope } from "@counted/kernel";
import type { Outbox } from "@counted/persistence-ports";
import { RowDecodeError, instantOf, timestampOf } from "./decode";
import { exec, firstRow, rows, type Queryable } from "./queryable";

/**
 * How long a claim survives before another worker may take the row. Long enough
 * that a slow HTTP delivery is not redelivered under itself; short enough that a
 * crashed worker's backlog moves again within a sweep or two.
 */
export const DEFAULT_CLAIM_LEASE_SECONDS = 300;

type OutboxRow = {
  readonly id: string;
  readonly type: string;
  readonly occurred_at: Date;
  readonly payload: unknown;
};

export type OutboxOptions = {
  readonly leaseSeconds?: number;
};

export class PostgresOutbox implements Outbox {
  private readonly leaseSeconds: number;

  constructor(
    private readonly db: Queryable,
    options: OutboxOptions = {},
  ) {
    this.leaseSeconds = options.leaseSeconds ?? DEFAULT_CLAIM_LEASE_SECONDS;
  }

  /**
   * Insert every envelope, ignoring one whose id is already present.
   *
   * The id comes from the use case's `IdGenerator` and is stable across
   * redeliveries, so a retried command that mints the same envelope twice
   * enqueues it once. `ON CONFLICT DO NOTHING` rather than a check-then-insert,
   * for the same reason the webhook ledger uses it.
   */
  async enqueue(events: readonly EventEnvelope[]): Promise<void> {
    if (events.length === 0) return;

    const values: unknown[] = [];
    const placeholders = events.map((event) => {
      const base = values.length;
      values.push(
        event.id,
        event.type,
        timestampOf(event.occurredAt),
        JSON.stringify(event.payload),
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`;
    });

    await exec(
      this.db,
      `INSERT INTO outbox (id, type, occurred_at, payload)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (id) DO NOTHING`,
      values,
    );
  }

  async claim(limit: number): Promise<readonly EventEnvelope[]> {
    if (limit <= 0) return [];

    const claimed = await rows<OutboxRow>(
      this.db,
      `UPDATE outbox SET claimed_at = now()
       WHERE id IN (
         SELECT id FROM outbox
         WHERE dispatched_at IS NULL
           AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => $2))
         ORDER BY occurred_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       RETURNING id, type, occurred_at, payload`,
      [limit, this.leaseSeconds],
    );

    // RETURNING follows the UPDATE's row order, not the subquery's ORDER BY, so
    // the oldest-first guarantee has to be restored here. A worker that
    // dispatches out of order will deliver a rename before the creation it
    // renamed.
    return claimed
      .map((row) => envelopeOf(row))
      .sort((a, b) => Instant.compare(a.occurredAt, b.occurredAt) || a.id.localeCompare(b.id));
  }

  async markDispatched(ids: readonly string[], at: Instant): Promise<void> {
    if (ids.length === 0) return;
    await exec(this.db, `UPDATE outbox SET dispatched_at = $2 WHERE id = ANY($1::text[])`, [
      [...ids],
      timestampOf(at),
    ]);
  }

  /**
   * Record a failed delivery and hand back the new attempt count, so the caller
   * can decide when to stop trying.
   *
   * Clearing `claimed_at` is the important half: a failure must leave the row
   * claimable again. Leaving the claim in place would make the row wait out its
   * whole lease before anyone retried it, which turns a transient 502 into five
   * minutes of silence.
   */
  async recordFailure(id: string, error: string, at: Instant): Promise<number> {
    const row = await firstRow<{ attempts: number }>(
      this.db,
      `UPDATE outbox
         SET attempts = attempts + 1, last_error = $2, last_failed_at = $3, claimed_at = NULL
       WHERE id = $1
       RETURNING attempts`,
      [id, error, timestampOf(at)],
    );
    // An UPDATE that matched nothing is the failure mode this whole package is
    // written against; it must not be reported as a successful zeroth attempt.
    if (row === null) throw new Error(`outbox row ${JSON.stringify(id)} does not exist`);
    return row.attempts;
  }

  async pendingCount(): Promise<number> {
    const row = await firstRow<{ pending: string }>(
      this.db,
      `SELECT count(*) AS pending FROM outbox WHERE dispatched_at IS NULL`,
    );
    return Number(row?.pending ?? 0);
  }
}

const envelopeOf = (row: OutboxRow): EventEnvelope => ({
  id: row.id,
  type: row.type,
  occurredAt: instantOf(row.occurred_at),
  payload: payloadOf(row),
});

/**
 * A payload is a domain event, which means it has a `kind` and an `at`. Nothing
 * else is checked — the worker dispatches on `type`, and inventing a stricter
 * shape here would mean this package had to know every context's event union.
 */
const payloadOf = (row: OutboxRow): DomainEvent => {
  const raw = row.payload;
  if (typeof raw === "object" && raw !== null) {
    const candidate = raw as { kind?: unknown; at?: unknown };
    if (typeof candidate.kind === "string" && typeof candidate.at === "number") {
      return raw as DomainEvent;
    }
  }
  throw new RowDecodeError("outbox", row.id, "payload", raw);
};
