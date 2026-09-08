/**
 * Outbox — domain events leaving the transaction that produced them.
 *
 * Written in the same transaction as the aggregate, dispatched later by the
 * worker. That is what makes "the change happened but the email did not" a
 * recoverable state rather than a lost one.
 */

import type { EventEnvelope, Instant } from "@counted/kernel";

export interface Outbox {
  /** Called inside `UnitOfWork.transact`, never outside it. */
  enqueue(events: readonly EventEnvelope[]): Promise<void>;

  /**
   * Take up to `limit` undispatched events and mark them in-flight, so two
   * workers cannot claim the same row.
   */
  claim(limit: number): Promise<readonly EventEnvelope[]>;

  markDispatched(ids: readonly string[], at: Instant): Promise<void>;

  /**
   * Record a failed delivery and return the new attempt count.
   *
   * Separate from `markDispatched` because a failure must leave the row
   * claimable again — the point is to try later, not to give up.
   */
  recordFailure(id: string, error: string, at: Instant): Promise<number>;

  /** Undispatched events. A growing count means dispatch has stalled. */
  pendingCount(): Promise<number>;
}
