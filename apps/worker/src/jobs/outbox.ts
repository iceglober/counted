/**
 * Outbox dispatch: the only place a domain event leaves the database.
 *
 * The outbox exists because a write and a notification cannot both be atomic.
 * The write enqueues the event inside the same transaction that changed the
 * aggregate, and this loop delivers it afterwards — so a subscriber never hears
 * about a change that rolled back, and a delivery that fails does not undo the
 * change. Delivery is therefore **at least once**, and every envelope carries a
 * stable `id` so a receiver can deduplicate.
 *
 * This is also the only retry loop in the system. `Notifier` deliberately makes
 * one attempt and lets it fail, because the durable attempt count lives here:
 * `recordFailure` returns how many times an envelope has been tried, and past
 * `maxAttempts` it is reported as dead-lettered rather than retried forever.
 * Two retry loops with two backoffs and two limits is worse than none.
 *
 * **Successes are marked in one call.** `markDispatched` takes a list, so a
 * batch of fifty is one statement rather than fifty. A failure in the middle
 * does not lose the successes before it: they are marked at the end regardless
 * of how many of their neighbours failed.
 */

import type { EventEnvelope } from "@counted/kernel";
import type { Instant } from "@counted/kernel";
import type { Outbox } from "@counted/persistence-ports";

import { describeError } from "../logging";
import type { Logger } from "../ports";

/**
 * Where an envelope goes. Supplied by the composition root because the
 * destination is a deployment decision: today a customer webhook through
 * `Notifier`, tomorrow a queue, in a test an array.
 *
 * Throwing is how a dispatcher fails. It is the shape `Notifier.deliver`
 * already has, and turning a `Result` into a throw here to reach the retry
 * would be a second way to say the same thing.
 */
export type EnvelopeDispatcher = (envelope: EventEnvelope) => Promise<void>;

export type OutboxDispatchDeps = {
  readonly outbox: Outbox;
  readonly dispatch: EnvelopeDispatcher;
  readonly logger: Logger;
  readonly batch: number;
  /**
   * After this many failed attempts an envelope stops being retried and is
   * reported. Not deleted — the row is the evidence, and a subscriber that was
   * down for an hour should be diagnosable afterwards.
   */
  readonly maxAttempts: number;
};

export type OutboxDispatchReport = {
  readonly claimed: number;
  readonly dispatched: number;
  readonly failed: number;
  readonly deadLettered: number;
  /** Undispatched envelopes still waiting, measured after this pass. */
  readonly pending: number;
};

export const dispatchOutbox = async (
  deps: OutboxDispatchDeps,
  now: Instant,
): Promise<OutboxDispatchReport> => {
  const claimed = await deps.outbox.claim(deps.batch);

  const delivered: string[] = [];
  let failed = 0;
  let deadLettered = 0;

  for (const envelope of claimed) {
    try {
      await deps.dispatch(envelope);
      delivered.push(envelope.id);
    } catch (cause) {
      failed += 1;
      const detail = describeError(cause);
      const attempts = await deps.outbox.recordFailure(envelope.id, detail, now);

      if (attempts >= deps.maxAttempts) {
        deadLettered += 1;
        // Error level and its own event name: this envelope will not be tried
        // again, so this line is the only notice anybody gets that a
        // subscriber permanently missed a fact.
        deps.logger.error("outbox.dead-lettered", {
          envelope: envelope.id,
          type: envelope.type,
          attempts,
          detail,
        });
      } else {
        deps.logger.warn("outbox.dispatch-failed", {
          envelope: envelope.id,
          type: envelope.type,
          attempts,
          detail,
        });
      }
    }
  }

  if (delivered.length > 0) await deps.outbox.markDispatched(delivered, now);

  return {
    claimed: claimed.length,
    dispatched: delivered.length,
    failed,
    deadLettered,
    pending: await deps.outbox.pendingCount(),
  };
};
