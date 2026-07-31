/**
 * EventWriter — the write side of ingestion.
 *
 * `append` resolves **only after the batch is durably committed**. That single
 * rule is what turns the API's 202 from a hope into a promise.
 *
 * v1 acknowledged before durability: events went into a module-global array,
 * the request returned 202, and a flush happened later on a timer. A deploy
 * mid-flush lost them. The buffer's own comment claimed failed batches were
 * re-queued; they were not — `batch` was a local and was dropped after a
 * bisection that isolated poison rows. And `MAX_BUFFER_CAP` was only checked
 * inside `flush()`, so a hung database grew the buffer without limit while the
 * documented 50,000 ceiling never applied.
 *
 * Delivery is therefore **at-least-once with a dedup key**, not the
 * "neither at-most-once nor at-least-once" v1 shipped. Retries are safe
 * because `idempotencyKey` makes them idempotent; loss is bounded because
 * nothing is acknowledged until it is written.
 */

import type { Instant, PersonId, ProjectId, VisitId } from "@counted/domain";

/**
 * An event as it reaches storage. Already validated; the domain's rules ran
 * before this point.
 */
export type WritableEvent = {
  readonly project: ProjectId;
  readonly name: string;
  readonly occurredAt: Instant;
  readonly visit: VisitId;
  /** Present only when the customer called identify(). */
  readonly person: PersonId | null;
  /**
   * Caller-supplied dedup key. Two events with the same key in the same
   * project are the same event, however many times they arrive.
   */
  readonly idempotencyKey: string;
  readonly properties: Readonly<Record<string, string | number | boolean | null>>;
  readonly system: Readonly<Record<string, string | null>>;
};

export type AppendReceipt = {
  /** Rows newly written. */
  readonly accepted: number;
  /** Rows recognised as already present via their idempotency key. */
  readonly deduplicated: number;
  /**
   * Which rows were newly written, identified the way the dedup key is.
   *
   * Counts alone cannot tell a caller *which* of its events was a duplicate,
   * and the receipt reports that per event. Returning the identities is what
   * makes `deduplicated: true` on one line of a receipt a fact rather than an
   * inference from arithmetic.
   */
  readonly written: readonly { readonly idempotencyKey: string; readonly occurredAt: Instant }[];
  /** When the transaction committed. Real, not a guess. */
  readonly committedAt: Instant;
};

export type AppendError =
  | { readonly code: "store_unavailable"; readonly detail: string; readonly retriable: true }
  | { readonly code: "timeout"; readonly budgetMs: number; readonly retriable: true }
  | { readonly code: "rejected"; readonly detail: string; readonly retriable: false };

export interface EventWriter {
  /**
   * Resolves after commit. Rejects with an `AppendError` otherwise — the
   * caller must surface that (503 with Retry-After), never swallow it into a
   * success response.
   */
  append(
    events: readonly WritableEvent[],
    options: { readonly deadlineMs: number },
  ): Promise<AppendReceipt>;
}

/**
 * UsageMeter — how many events a workspace has recorded this period.
 *
 * Separate from the writer because the ingest hot path reads it far more often
 * than it writes, and because v1 computed it with a month-wide `COUNT(*)`
 * joined to `project_members` **on the ingest path**, cached for five minutes
 * in a module-level Map. With more than one replica that cache diverged, and
 * quota enforcement was up to five minutes and N processes stale.
 */
export interface UsageMeter {
  eventsInCurrentPeriod(workspace: import("@counted/domain").WorkspaceId): Promise<number>;
}

/**
 * QuotaService — whether a project's workspace may ingest right now.
 *
 * The *decision* is pure and lives in the domain (`Quota.decide`). This port
 * is only the lookup that feeds it: which workspace owns the project, what it
 * is entitled to, and how much it has used.
 *
 * It is a port rather than a query on the ingest path because v1 computed this
 * with a month-wide `COUNT(*)` joined to `project_members` **on every ingest
 * request**, cached five minutes in a module-level Map. With more than one
 * replica the caches diverged, so enforcement was up to five minutes and N
 * processes stale — and the numbers a customer saw disagreed between refreshes.
 */
export interface QuotaService {
  decide(project: import("@counted/domain").ProjectId): Promise<import("@counted/domain").QuotaDecision>;
}
