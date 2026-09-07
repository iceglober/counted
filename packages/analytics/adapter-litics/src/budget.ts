/**
 * One deadline, spent across every read a query makes.
 *
 * `QueryOptions.deadline` is a hard ceiling the port says an adapter "must
 * honour and return `Timeout`, not hang". A monthly unique series is one
 * engine read per month; each one gets what is left, not the whole budget
 * again, and the caller's abort signal rides along so a page nobody is
 * looking at any more stops the cursor walk between segments.
 */

import type { QueryOptions } from "@counted/analytics-ports";
import { Duration } from "@counted/kernel";

export type Budget = {
  readonly signal: AbortSignal | undefined;
  /** Milliseconds left, never below zero. */
  remainingMs(): number;
  expired(): boolean;
  /** What to hand litics as `statementTimeoutMs` for the next read. */
  statementTimeoutMs(): number;
};

export const openBudget = (options: QueryOptions, now: () => number = Date.now): Budget => {
  const total = Math.max(1, Math.ceil(Duration.toMillis(options.deadline)));
  const deadlineAt = now() + total;
  const remaining = (): number => Math.max(0, deadlineAt - now());
  return {
    signal: options.signal,
    remainingMs: remaining,
    expired: () => remaining() <= 0,
    statementTimeoutMs: () => Math.max(1, Math.ceil(remaining())),
  };
};
