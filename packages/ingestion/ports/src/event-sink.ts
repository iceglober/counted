/**
 * EventSink — where admitted events go.
 *
 * `writeBatch`, never `write`. The ingest hot path coalesces many requests into
 * one group commit, and an interface that accepted single events would make
 * that impossible to express — every caller would batch by hand, differently.
 *
 * Under v3 the implementation is litics' `trackBatch`, which is one round trip
 * carrying a single jsonb array parameter. The shape here matches that on
 * purpose: an admitted event is already flat, already has its dimensions
 * resolved, and needs no further interpretation.
 *
 * Type-parameterised in the admitted event because `AdmittedEvent` is the
 * output of admission and lives in `@counted/ingestion-domain`; see the
 * convention note in `@counted/tenancy-ports/workspace-repository`.
 */

import type { ProjectId, Result } from "@counted/kernel";

export type WriteFailure =
  | { readonly kind: "SinkUnavailable"; readonly detail: string }
  | { readonly kind: "Timeout" };

export type WriteReceipt = {
  /** How many events were durably written. */
  readonly written: number;
  /** Zero-based positions in the submitted batch that were newly stored. */
  readonly writtenIndices: readonly number[];
  /**
   * How many were dropped as duplicates.
   *
   * Deduplication is at-least-once ingestion's other half: SDKs retry, and a
   * retried batch must not double-count. Reported rather than hidden, because
   * a client seeing every event deduplicated is a client with a broken id.
   */
  readonly deduplicated: number;
};

export interface EventSink<AdmittedEvent> {
  writeBatch(
    project: ProjectId,
    events: readonly AdmittedEvent[],
  ): Promise<Result<WriteReceipt, WriteFailure>>;
}
