/**
 * EventRetention — deleting a project's events before an instant.
 *
 * Here rather than in the worker, because deleting rows out of the analytics
 * store is litics-schema work and `@counted/analytics-adapter-litics` is the
 * only package allowed to know that schema. The worker's retention sweep is
 * written against this interface and reports itself unavailable when nothing
 * implements it, rather than scanning happily and deleting nothing.
 *
 * **Granularity.** The store keeps events in immutable segments of ~10,000,
 * each spanning a range of time. A purge deletes whole segments whose newest
 * event is before `before`, plus any unpacked rows before it; a segment that
 * straddles `before` is kept whole. So a purge errs toward keeping slightly
 * more than asked — "at least N days", never fewer — and the promise on the
 * pricing page is kept to within a segment's span, which for a busy project
 * is minutes and for a quiet one is at most a day.
 */

import type { Instant, ProjectId, Result } from "@counted/kernel";

/** Delete this project's events recorded before this instant. */
export type PurgeRequest = {
  readonly project: ProjectId;
  readonly before: Instant;
};

export type PurgeFailure =
  | { readonly kind: "StoreUnavailable"; readonly detail: string }
  | { readonly kind: "Timeout" };

export interface EventRetention {
  /** Events deleted, or why none were. Idempotent: a second call deletes nothing. */
  purge(request: PurgeRequest): Promise<Result<number, PurgeFailure>>;
}
