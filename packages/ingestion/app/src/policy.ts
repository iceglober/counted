/**
 * When to commit, and when to refuse. Pure functions, no timers, no promises.
 *
 * Group commit is one idea: while a write is in flight, requests that arrive
 * behind it form the next group, and one `INSERT … SELECT` over a jsonb array
 * costs barely more than one over a single row. Throughput stops being a
 * function of request rate and becomes a function of commit latency.
 *
 * The policy is separated from the machinery because every interesting failure
 * lives here and none of them are easy to provoke through a socket:
 *
 * - **Starvation.** The linger deadline runs from the *oldest* event in the
 *   group, not the newest. Measured from the newest, a steady trickle keeps
 *   pushing the deadline out and the first event waits forever.
 * - **Unbounded buffering.** A sink that has been down for a minute must make
 *   arrivals fail, not accumulate. The ceiling is checked on arrival, which is
 *   the only place it can be true — v1's SDK checked its cap at flush time and
 *   so never enforced it while the server was down, the one time it mattered.
 * - **Lying about durability.** There is no "accepted, will write later"
 *   answer here. A request either joins a group and waits for that group's
 *   commit, or it is refused with a status that tells the client to retry.
 */

import { Duration, Instant } from "@counted/kernel";

export type GroupCommitPolicy = {
  /** How long a group waits for company before committing anyway. */
  readonly linger: Duration;
  /** Commit early once the group is this big. */
  readonly maxEvents: number;
  /** Commit early once this many requests have joined, however small each is. */
  readonly maxWaiters: number;
  /** Total events that may be waiting across all groups before arrivals are refused. */
  readonly maxBuffered: number;
  /** How many commits may be in flight at once. */
  readonly maxInFlight: number;
  /** What a refused client is told to wait. */
  readonly retryAfter: Duration;
};

export const DEFAULT_GROUP_COMMIT_POLICY: GroupCommitPolicy = {
  // Short enough that a single-client dev loop still feels immediate, long
  // enough that a busy project fills a group. Anything past ~50ms is
  // perceptible on a synchronous `flush()` from an SDK.
  linger: Duration.millis(20),
  maxEvents: 500,
  maxWaiters: 64,
  // ~100k events at the SDK's 250-per-batch cap is a few hundred requests
  // deep. Past that the sink is not slow, it is down.
  maxBuffered: 50_000,
  maxInFlight: 4,
  retryAfter: Duration.seconds(1),
};

/** A group being assembled. `openedAt` is when its FIRST event joined. */
export type PendingGroup = {
  readonly events: number;
  readonly waiters: number;
  readonly openedAt: Instant;
};

export type CommitState = {
  readonly group: PendingGroup | null;
  readonly inFlight: number;
  /** True once shutdown has begun: everything pending commits, deadline or not. */
  readonly draining: boolean;
};

export type FlushReason = "Size" | "Waiters" | "Linger" | "Drain";

export type Decision =
  | { readonly kind: "Flush"; readonly reason: FlushReason }
  /** Not ready. The transport arms a timer for `until` and calls back. */
  | { readonly kind: "Wait"; readonly until: Instant }
  /** Ready, but the commit concurrency ceiling is reached. Retried when one finishes. */
  | { readonly kind: "Blocked" }
  | { readonly kind: "Idle" };

/**
 * Why a group would commit, or `null` if it would not yet.
 *
 * Order matters only for the reason reported, not for the outcome — but the
 * reason is what a metric is cut by, and "we flush on size" versus "we flush
 * on the timer" is the difference between a healthy pipeline and one where the
 * linger is doing all the work.
 */
const flushReason = (group: PendingGroup, state: CommitState, policy: GroupCommitPolicy, at: Instant): FlushReason | null => {
  if (state.draining) return "Drain";
  if (group.events >= policy.maxEvents) return "Size";
  if (group.waiters >= policy.maxWaiters) return "Waiters";
  // From the oldest event, not the newest. See the module comment.
  if (!Instant.isBefore(at, deadline(group, policy))) return "Linger";
  return null;
};

/** When this group commits at the latest. */
export const deadline = (group: PendingGroup, policy: GroupCommitPolicy): Instant =>
  Instant.plus(group.openedAt, policy.linger);

export const decide = (state: CommitState, policy: GroupCommitPolicy, at: Instant): Decision => {
  if (state.group === null) return { kind: "Idle" };

  const reason = flushReason(state.group, state, policy, at);
  if (reason === null) return { kind: "Wait", until: deadline(state.group, policy) };

  // Bounded concurrency. Without it a slow sink turns every arrival into
  // another open connection and the ceiling above stops meaning anything.
  if (state.inFlight >= policy.maxInFlight) return { kind: "Blocked" };

  return { kind: "Flush", reason };
};

export type Reception =
  /** There is room. The request joins a group and waits for its commit. */
  | { readonly kind: "Accept" }
  /** There is not. The client is told to come back — never told "accepted". */
  | { readonly kind: "Refuse"; readonly retryAfter: Duration };

/**
 * Whether an arriving request may be buffered at all.
 *
 * Checked on arrival rather than at flush time. A ceiling consulted only when
 * draining does nothing during the only period it exists for — the one where
 * the sink is not draining.
 */
export const receive = (buffered: number, arriving: number, policy: GroupCommitPolicy): Reception =>
  buffered + arriving > policy.maxBuffered
    ? { kind: "Refuse", retryAfter: policy.retryAfter }
    : { kind: "Accept" };
