/**
 * The shape every domain event shares.
 *
 * Each context defines its own closed union — `WorkspaceEvent`,
 * `DashboardEvent` — and this is the floor those unions stand on. Two fields,
 * both load-bearing:
 *
 *   `kind`  the discriminant, so `assertNever` makes a new variant a compile
 *           error at every place that handles them.
 *   `at`    when it happened, as a value. A domain function is handed the
 *           instant it is acting at; stamping the event from a clock later
 *           would let the record disagree with the decision that produced it.
 *
 * The envelope is what leaves the transaction. It carries routing metadata the
 * outbox needs and the aggregate does not: a delivery id and a fully qualified
 * type string.
 */

import type { Instant } from "./instant";

export type DomainEvent = {
  readonly kind: string;
  readonly at: Instant;
};

export type EventEnvelope<E extends DomainEvent = DomainEvent> = {
  /**
   * Stable across redeliveries. Dispatch is at-least-once, so this is what
   * makes a receiver's deduplication possible — it travels as `webhook-id`.
   */
  readonly id: string;
  /** `"<context>.<Kind>"`, e.g. `"dashboarding.TileAdded"`. */
  readonly type: string;
  readonly occurredAt: Instant;
  readonly payload: E;
};
