/**
 * The coalescer: many requests, one commit, one acknowledgement each — after
 * the commit, never before.
 *
 * This owns the policy and the promises. It does not own the socket: there is
 * no timer here, no `setTimeout`, no fetch. The transport in `apps/api` asks
 * `nextDeadlineAt()` when it should look again and calls `tick()` when that
 * time arrives. Keeping it that way is what makes every case below testable
 * without a clock that really ticks, and it is why the whole hot path can be
 * exercised in a millisecond.
 *
 * The contract in one line: **`submit` resolves when the events are durable,
 * or it resolves saying they are not.** There is no third answer. v1's ingest
 * returned 202 with an empty body whether it had written the batch or dropped
 * it past a quota — byte-identical responses for "stored" and "discarded" —
 * and the SDK could not tell, so it moved on either way. Every branch here
 * ends in an `Ack` that names which happened.
 */

import { Duration, Instant, assertNever, unbrand } from "@counted/kernel";
import type { ProjectId, WorkspaceId } from "@counted/kernel";
import type { Clock } from "@counted/kernel/ports";

import { DEFAULT_ADMISSION_POLICY, admit, collapseDuplicates } from "@counted/ingestion-domain";
import type {
  AdmissionPolicy,
  AdmittedEvent,
  BatchAdmissionError,
  DedupKey,
  IngestBatch,
  RejectedEvent,
} from "@counted/ingestion-domain";

import {
  DEFAULT_GROUP_COMMIT_POLICY,
  decide,
  deadline,
  receive,
  type GroupCommitPolicy,
} from "./policy";
import type { EventSink, IngestQuota, WriteFailure } from "./ports";

/** What the group commit this request rode on actually did. */
export type CommitSummary = {
  /** Events in the group, including other requests' — this is a group fact, not yours. */
  readonly size: number;
  readonly written: number;
  /** Repeats the sink recognised from earlier batches. A high number means a broken key generator. */
  readonly deduplicated: number;
};

export type Ack =
  | {
      readonly kind: "Committed";
      /** This request's events newly written by the sink. */
      readonly accepted: number;
      /** Repeats found during admission, coalescing, or in durable storage. */
      readonly deduplicated: number;
      readonly rejected: readonly RejectedEvent[];
      /** `null` when there was nothing to commit — every event was rejected. */
      readonly commit: CommitSummary | null;
    }
  | {
      readonly kind: "Refused";
      readonly error: BatchAdmissionError;
      /**
       * Per-event problems found before the batch was refused. Reported even
       * on refusal: a client whose quota ran out still wants to know that
       * three of its events were malformed, or it will resend them forever.
       */
      readonly rejected: readonly RejectedEvent[];
    };

/**
 * Something that went wrong after the point where it could change the answer.
 *
 * Reported rather than thrown or swallowed. A durable write must not be
 * acknowledged as a failure because a usage counter did not increment, and it
 * must not be silently forgotten either.
 */
export type CommitProblem =
  | { readonly kind: "QuotaNotRecorded"; readonly project: ProjectId; readonly events: number; readonly detail: string }
  | { readonly kind: "SinkThrew"; readonly project: ProjectId; readonly events: number; readonly detail: string };

export type GroupCommitDeps = {
  readonly sink: EventSink;
  readonly quota: IngestQuota;
  readonly clock: Clock;
  readonly policy?: GroupCommitPolicy;
  readonly admission?: AdmissionPolicy;
  readonly onProblem?: (problem: CommitProblem) => void;
};

type Waiter = {
  /** How many of this request's events went into the group. */
  readonly contributed: number;
  /** First position owned by this request in the committed batch. */
  readonly offset: number;
  readonly duplicates: number;
  readonly rejected: readonly RejectedEvent[];
  readonly settle: (ack: Ack) => void;
};

type Group = {
  readonly project: ProjectId;
  readonly workspace: WorkspaceId;
  readonly events: AdmittedEvent[];
  readonly keys: Set<DedupKey>;
  readonly waiters: Waiter[];
  /** When the first event joined. The linger runs from here — see `policy.ts`. */
  readonly openedAt: Instant;
};

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * Every way the sink can fail becomes one client-facing answer: 503, retry.
 *
 * They are genuinely the same instruction. A timeout and a dead connection
 * both mean "we did not write this and you still hold it"; the difference
 * matters to us and not to the client, so it travels in `detail` rather than
 * in the code.
 */
const sinkRefusal = (failure: WriteFailure): BatchAdmissionError => {
  switch (failure.kind) {
    case "SinkUnavailable":
      return { kind: "SinkUnavailable", detail: failure.detail };
    case "Timeout":
      return { kind: "SinkUnavailable", detail: "the sink did not answer in time" };
    default:
      return assertNever(failure, "unhandled WriteFailure");
  }
};

export class GroupCommit {
  readonly #sink: EventSink;
  readonly #quota: IngestQuota;
  readonly #clock: Clock;
  readonly #policy: GroupCommitPolicy;
  readonly #admission: AdmissionPolicy;
  readonly #onProblem: (problem: CommitProblem) => void;

  readonly #groups = new Map<string, Group>();
  readonly #commits = new Set<Promise<void>>();
  #buffered = 0;
  #draining = false;

  constructor(deps: GroupCommitDeps) {
    this.#sink = deps.sink;
    this.#quota = deps.quota;
    this.#clock = deps.clock;
    this.#policy = deps.policy ?? DEFAULT_GROUP_COMMIT_POLICY;
    this.#admission = deps.admission ?? DEFAULT_ADMISSION_POLICY;
    this.#onProblem = deps.onProblem ?? (() => {});
  }

  /**
   * Events waiting for a commit, bounded by `policy.maxBuffered`.
   *
   * Events already handed to the sink are not counted here — they are bounded
   * separately by `maxInFlight`, so total memory is
   * `maxBuffered + maxInFlight * maxEvents` and never more.
   */
  get buffered(): number {
    return this.#buffered;
  }

  /** Requests holding an unresolved ack. */
  get waiting(): number {
    let total = 0;
    for (const group of this.#groups.values()) total += group.waiters.length;
    return total;
  }

  /**
   * When the transport should call `tick()`, or `null` if nothing is pending.
   *
   * The earliest deadline across all projects: one timer for the process, not
   * one per project. Re-read after every `submit` and every `tick`, because a
   * newly opened group can be sooner than the one that was pending.
   */
  nextDeadlineAt(): Instant | null {
    let earliest: Instant | null = null;
    for (const group of this.#groups.values()) {
      const at = deadline({ events: group.events.length, waiters: group.waiters.length, openedAt: group.openedAt }, this.#policy);
      earliest = earliest === null ? at : Instant.min(earliest, at);
    }
    return earliest;
  }

  /**
   * Offer a batch. Resolves once the events it contributed are durable, or
   * with the reason they are not.
   *
   * Ordering is deliberate. Admission is pure and free, so it runs first and a
   * malformed batch never touches the quota service. The buffer ceiling is
   * checked before the quota because it is a local read and a full buffer is
   * the case where an extra round trip is exactly what we cannot afford.
   */
  async submit(batch: IngestBatch): Promise<Ack> {
    const outcome = admit(batch, this.#admission);
    if (!outcome.ok) return { kind: "Refused", error: outcome.error, rejected: [] };

    const { admitted, rejected, duplicates } = outcome.value;

    // Nothing survived admission — or the client flushed an empty batch. There
    // is nothing to make durable, so waiting for a commit would be waiting for
    // a commit this request is not in.
    if (admitted.length === 0) {
      return { kind: "Committed", accepted: 0, deduplicated: duplicates, rejected, commit: null };
    }

    if (this.#draining) {
      return {
        kind: "Refused",
        error: { kind: "SinkUnavailable", detail: "the server is shutting down" },
        rejected,
      };
    }

    const room = receive(this.#buffered, admitted.length, this.#policy);
    if (room.kind === "Refuse") return this.#backpressure(room.retryAfter, rejected);

    const verdict = await this.#quota.check(batch.project, admitted.length, batch.receivedAt);
    if (verdict.kind === "PlanExceeded") {
      return {
        kind: "Refused",
        error: { kind: "PlanExceeded", limit: verdict.limit, used: verdict.used },
        rejected,
      };
    }
    if (verdict.kind === "RateLimited") return this.#backpressure(verdict.retryAfter, rejected);

    // Re-checked after the await. The quota call is I/O, and an unbounded
    // number of requests can arrive while one is outstanding — checking only
    // before it makes the ceiling advisory.
    const stillRoom = receive(this.#buffered, admitted.length, this.#policy);
    if (stillRoom.kind === "Refuse") return this.#backpressure(stillRoom.retryAfter, rejected);

    const group = this.#groupFor(batch);
    const { unique, duplicates: repeats } = collapseDuplicates(admitted, group.keys);
    const offset = group.events.length;
    for (const event of unique) {
      if (event.dedupKey !== null) group.keys.add(event.dedupKey);
      group.events.push(event);
    }
    this.#buffered += unique.length;

    return new Promise<Ack>((resolve) => {
      // A request whose events were all duplicates of ones already buffered
      // still joins as a waiter. Acknowledging it immediately would say "we
      // have these" while the copies are still only in memory — and if that
      // group's commit then failed, the retry would have been told success
      // while the original was told failure.
      group.waiters.push({
        contributed: unique.length,
        offset,
        duplicates: duplicates + repeats,
        rejected,
        settle: resolve,
      });
      this.#pump();
    });
  }

  /**
   * Look again. Called by the transport when the deadline it armed fires.
   *
   * Synchronous and cheap: it starts commits, it does not wait for them.
   */
  tick(): void {
    this.#pump();
  }

  /**
   * Shut down: commit everything pending, settle every waiter, refuse arrivals.
   *
   * Resolves only when no request is left holding an unresolved promise. A
   * process that exits with waiters outstanding has accepted events and
   * answered nobody, which is the worst of both answers.
   */
  async drain(): Promise<void> {
    this.#draining = true;
    while (this.#groups.size > 0 || this.#commits.size > 0) {
      this.#pump();
      await Promise.all([...this.#commits]);
    }
  }

  #backpressure(retryAfter: Duration, rejected: readonly RejectedEvent[]): Ack {
    return {
      kind: "Refused",
      error: { kind: "RateLimited", retryAfterMs: Duration.toMillis(retryAfter) },
      rejected,
    };
  }

  #groupFor(batch: IngestBatch): Group {
    // One group per project: `writeBatch` takes a project, so events from two
    // projects cannot ride one commit however close together they arrived.
    const key = unbrand(batch.project);
    const existing = this.#groups.get(key);
    if (existing !== undefined) return existing;

    const group: Group = {
      project: batch.project,
      workspace: batch.workspace,
      events: [],
      keys: new Set<DedupKey>(),
      waiters: [],
      openedAt: this.#clock.now(),
    };
    this.#groups.set(key, group);
    return group;
  }

  #pump(): void {
    const at = this.#clock.now();

    for (const [key, group] of [...this.#groups]) {
      const decision = decide(
        {
          group: { events: group.events.length, waiters: group.waiters.length, openedAt: group.openedAt },
          inFlight: this.#commits.size,
          draining: this.#draining,
        },
        this.#policy,
        at,
      );
      if (decision.kind !== "Flush") continue;

      // Out of the map before the first await, so a request arriving during
      // the commit opens the next group rather than joining one that is
      // already being written.
      this.#groups.delete(key);
      this.#buffered -= group.events.length;

      const commit = this.#commit(group);
      this.#commits.add(commit);
      void commit.finally(() => {
        this.#commits.delete(commit);
        // A group that was Blocked on the concurrency ceiling can go now.
        this.#pump();
      });
    }
  }

  async #commit(group: Group): Promise<void> {
    try {
      const written = await this.#sink.writeBatch(group.project, group.events);

      if (!written.ok) {
        const error = sinkRefusal(written.error);
        for (const waiter of group.waiters) {
          waiter.settle({ kind: "Refused", error, rejected: waiter.rejected });
        }
        return;
      }

      const indices = new Set(written.value.writtenIndices);
      if (indices.size !== written.value.written ||
          written.value.written + written.value.deduplicated !== group.events.length ||
          [...indices].some((index) => !Number.isInteger(index) || index < 0 || index >= group.events.length)) {
        throw new Error("the sink returned an inconsistent write receipt");
      }

      const summary: CommitSummary = {
        size: group.events.length,
        written: written.value.written,
        deduplicated: written.value.deduplicated,
      };

      // Usage is recorded after the write and never before, so a failed commit
      // costs the customer nothing. A failure here does not change the answer:
      // the events are durable and saying otherwise would make the client
      // resend data we already hold.
      try {
        await this.#quota.record(group.workspace, summary.written, this.#clock.now(), group.project);
      } catch (cause) {
        this.#onProblem({
          kind: "QuotaNotRecorded",
          project: group.project,
          events: summary.written,
          detail: describe(cause),
        });
      }

      for (const waiter of group.waiters) {
        let accepted = 0;
        for (let index = waiter.offset; index < waiter.offset + waiter.contributed; index += 1) {
          if (indices.has(index)) accepted += 1;
        }
        waiter.settle({
          kind: "Committed",
          accepted,
          deduplicated: waiter.duplicates + waiter.contributed - accepted,
          rejected: waiter.rejected,
          commit: summary,
        });
      }
    } catch (cause) {
      // A sink that throws instead of returning `Err` is a broken adapter, not
      // a reason to leave every waiter hanging forever. They are told the
      // truth — nothing was written — and they still hold the events.
      const detail = describe(cause);
      this.#onProblem({ kind: "SinkThrew", project: group.project, events: group.events.length, detail });
      for (const waiter of group.waiters) {
        waiter.settle({
          kind: "Refused",
          error: { kind: "SinkUnavailable", detail },
          rejected: waiter.rejected,
        });
      }
    }
  }
}
