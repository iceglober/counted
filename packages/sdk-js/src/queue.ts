/**
 * The on-device queue.
 *
 * Keeps what v1 got right — a bounded buffer, and a failed batch returned to
 * the *head* so ordering survives a retry — and fixes what it got wrong.
 *
 * v1's cap was only consulted inside `flush()`, so a hung server grew the
 * buffer without limit while the documented 50,000 ceiling never applied. Here
 * the bound is enforced on every push, which is the only place it can be true.
 *
 * When the queue is full the **oldest** events are dropped, not the newest.
 * Recent events are the ones somebody is about to look at; a queue that
 * silently discards what just happened while keeping an hour-old backlog is
 * worse than useless.
 */

export type QueuedEvent = {
  readonly name: string;
  readonly visitId: string;
  readonly userId?: string | undefined;
  /** Stamped at track() time and never regenerated. */
  readonly occurredAt: string;
  /** Minted at track() time and never regenerated, so a retry deduplicates. */
  readonly idempotencyKey: string;
  readonly properties?: Readonly<Record<string, string | number | boolean | null>> | undefined;
  readonly systemProperties?: Readonly<Record<string, string | null>> | undefined;
};

export class EventQueue {
  private events: QueuedEvent[] = [];
  private dropped = 0;

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.events.length;
  }

  /** How many events have been dropped for capacity. Reported, never silent. */
  get droppedCount(): number {
    return this.dropped;
  }

  push(event: QueuedEvent): void {
    this.events.push(event);
    this.trim();
  }

  /** Take up to `limit` events from the front. */
  take(limit: number): readonly QueuedEvent[] {
    return this.events.splice(0, limit);
  }

  /**
   * Return an unsent batch to the head.
   *
   * At the head rather than the tail so a retry does not reorder events behind
   * ones that arrived while it was in flight. Still bounded: a server that has
   * been down for an hour must not turn this into a memory leak.
   */
  requeue(events: readonly QueuedEvent[]): void {
    this.events.unshift(...events);
    this.trim();
  }

  private trim(): void {
    const excess = this.events.length - this.capacity;
    if (excess <= 0) return;
    // Oldest first. What just happened matters more than what happened an
    // hour ago and has been failing to send since.
    this.events.splice(0, excess);
    this.dropped += excess;
  }
}
