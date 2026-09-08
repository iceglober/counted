/**
 * At-least-once delivery, made safe.
 *
 * The SDKs retry: a network error tells a client nothing about whether the
 * batch landed, so the only correct move is to send it again. That is only
 * survivable if the server can recognise the resend, and recognising it is
 * what this module does.
 *
 * **The key is (idempotencyKey, occurredAt), not the key alone.** Both halves
 * are minted once at `track()` time and reused verbatim on every retry
 * (SDK-010, SDK-011). The instant is in the key because it is the half that
 * catches a client whose key generator collides — a `Math.random()` suffix,
 * a counter that resets when the process restarts — and because an event
 * genuinely re-tracked later is a *different* event that happens to reuse a
 * key. Keying on the id alone would silently swallow it.
 *
 * Deduplication here is the fast path only: it collapses repeats it can see in
 * the group being assembled. The durable guarantee is the sink's, which
 * enforces uniqueness on the same key across every batch ever written and
 * reports what it collapsed. Two layers, and the in-memory one is bounded by
 * the buffer it lives in — a server-side "recently seen" cache that is not
 * bounded is a memory leak wearing a correctness hat.
 */

import { Instant } from "@counted/kernel";
import type { Brand } from "@counted/kernel";

/**
 * The unit of "this is the same event". Opaque on purpose: nothing may take it
 * apart, because the moment something parses it the two halves become two
 * fields and one of them gets dropped.
 */
export type DedupKey = Brand<string, "DedupKey">;

export const dedupKey = (idempotencyKey: string, occurredAt: Instant): DedupKey =>
  `${idempotencyKey}\u0000${Instant.toEpochMillis(occurredAt)}` as DedupKey;

/** Anything carrying a key. Written this way so the collapse works on both raw and admitted events. */
export type Deduplicable = { readonly dedupKey: DedupKey | null };

export type Deduplicated<T> = {
  readonly unique: readonly T[];
  /**
   * How many were dropped as repeats. Reported, never hidden: a client seeing
   * everything deduplicate is a client with a broken key generator, and the
   * only way it finds out is if we say so.
   */
  readonly duplicates: number;
};

/**
 * Collapse repeats, keeping the first occurrence.
 *
 * First rather than last because the first is the one already ordered ahead of
 * its neighbours; keeping the last would reorder an event behind ones tracked
 * after it, for no gain — the two are the same event by definition.
 *
 * An event with no key is never a duplicate of anything. Passing no
 * idempotency key is opting out: the client gets at-least-once with no
 * collapse, which is what happens to anything hand-rolled with curl or coming
 * through a compatibility shim that has no key to give us.
 */
export const collapseDuplicates = <T extends Deduplicable>(
  events: readonly T[],
  seen: ReadonlySet<DedupKey> = new Set(),
): Deduplicated<T> => {
  const keys = new Set<DedupKey>(seen);
  const unique: T[] = [];
  let duplicates = 0;

  for (const event of events) {
    if (event.dedupKey === null) {
      unique.push(event);
      continue;
    }
    if (keys.has(event.dedupKey)) {
      duplicates += 1;
      continue;
    }
    keys.add(event.dedupKey);
    unique.push(event);
  }

  return { unique, duplicates };
};
