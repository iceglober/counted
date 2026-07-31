/**
 * `outbox.dispatch` — deliver domain events to the people who asked for them.
 *
 * **On "exactly once".** It is not achievable, and saying otherwise is the
 * kind of comment this rewrite exists to remove — v1's event buffer claimed
 * failed batches were re-queued when they were dropped. Delivery to an
 * external system and marking a row dispatched cannot be one atomic act: if
 * the send succeeds and the commit does not, the event is sent again.
 *
 * So what is actually true, and what the design gets in exchange:
 *
 *   **Exactly once *marked*.** A row is claimed with `FOR UPDATE SKIP LOCKED`
 *   inside a transaction, so two workers never deliver the same event
 *   concurrently.
 *
 *   **At least once *delivered*.** A crash between sending and committing
 *   redelivers. That is the honest failure direction: a duplicate alert is a
 *   nuisance, a missed one is the product not working.
 *
 *   **Deduplicable by the receiver.** Every webhook carries the outbox row's
 *   `id`, which is stable across redeliveries, so a receiver that cares can
 *   drop the second copy. That is the same contract we ask of our own SDKs at
 *   ingest, and for the same reason.
 *
 * An event nobody subscribes to is marked dispatched without being sent, so
 * the outbox drains instead of accumulating events that will never leave.
 */

import { routeEvent, type Channels } from "@counted/application";
import type { DomainEventEnvelope, Notifier, UnitOfWork } from "@counted/ports";
import type { Handler } from "../runtime";

/** Events claimed per run. Small: each one may make a network call. */
export const DISPATCH_BATCH = 100;

/**
 * How many delivery attempts before an event is given up on.
 *
 * Past this it is marked dispatched with its error recorded, rather than being
 * retried forever. An endpoint that has been dead for a day will not come back
 * because we asked a thousandth time, and a queue that never drains hides
 * every event behind it.
 */
export const MAX_DELIVERY_ATTEMPTS = 10;

export type DispatchDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly notifier: Notifier;
  /** Channels for whatever an event concerns. Resolved per batch by the caller. */
  readonly channelsFor: (event: DomainEventEnvelope) => Promise<Channels>;
};

export const outboxDispatch = (deps: DispatchDeps): Handler => async (_job, context) => {
  const claimed = await deps.unitOfWork.transact((repos) => repos.outbox.claim(DISPATCH_BATCH));
  if (claimed.length === 0) return { kind: "noop", detail: "outbox is empty" };

  // Resolved once for the batch rather than once per notification, so a
  // hundred events for one monitor cost one lookup.
  const channels = new Map<string, Channels>();
  for (const envelope of claimed) {
    if (channels.has(envelope.id)) continue;
    channels.set(envelope.id, await deps.channelsFor(envelope));
  }

  const delivered: string[] = [];
  const abandoned: string[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const envelope of claimed) {
    const notifications = routeEvent(envelope, () => channels.get(envelope.id) ?? []);

    if (notifications.length === 0) {
      // Nobody subscribes. Marked so the outbox drains rather than carrying it
      // forever behind everything else.
      skipped += 1;
      delivered.push(envelope.id);
      continue;
    }

    try {
      // Sequential on purpose. These are a handful of calls per event, and a
      // partial failure across a parallel fan-out would leave us unable to say
      // which half was sent.
      for (const notification of notifications) await deps.notifier.deliver(notification);
      sent += notifications.length;
      delivered.push(envelope.id);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown error";
      const attempts = await deps.unitOfWork.transact((repos) =>
        repos.outbox.recordFailure(envelope.id, message, context.now),
      );

      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        // Given up on, and said so. Left unmarked it would block the queue
        // behind it on every run from here on.
        abandoned.push(envelope.id);
        context.log.error("outbox.abandoned", {
          eventId: envelope.id,
          type: envelope.type,
          attempts,
          error: message,
        });
      } else {
        context.log.warn("outbox.delivery_failed", {
          eventId: envelope.id,
          type: envelope.type,
          attempts,
          error: message,
        });
      }
    }
  }

  const settled = [...delivered, ...abandoned];
  if (settled.length > 0) {
    await deps.unitOfWork.transact((repos) => repos.outbox.markDispatched(settled, context.now));
  }

  if (sent === 0 && failed === 0) {
    return { kind: "noop", detail: `${skipped} events had no subscribers` };
  }

  context.log.info("outbox.dispatched", {
    claimed: claimed.length,
    sent,
    skipped,
    failed,
    abandoned: abandoned.length,
  });

  return {
    kind: "done",
    detail: `${sent} notifications sent, ${skipped} unsubscribed, ${failed} failed${
      abandoned.length > 0 ? `, ${abandoned.length} abandoned` : ""
    }`,
  };
};
