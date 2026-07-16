import { db } from "./db";
import { events } from "./db/schema";
import { logError, logWarn } from "./log";

type EventRow = typeof events.$inferInsert;

let buffer: EventRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 200;
// Hard ceiling so a persistently-failing DB (or a poison row that somehow keeps
// re-queuing) can never grow the in-memory queue without bound. Oldest rows are
// dropped first once we exceed this.
const MAX_BUFFER_CAP = 50_000;
// Per-batch retry budget before we bisect to isolate poison rows.
const MAX_BATCH_RETRIES = 1;

/**
 * Insert a batch, isolating "poison" rows (e.g. an Invalid Date that Postgres
 * rejects) so a single bad row can't wedge the whole buffer forever. On failure
 * we bisect the batch and retry the halves; a row that fails alone is logged and
 * dropped rather than re-queued indefinitely.
 */
async function insertResilient(batch: EventRow[]): Promise<void> {
  if (batch.length === 0) return;

  try {
    await db.insert(events).values(batch);
    return;
  } catch (err) {
    if (batch.length === 1) {
      // A single row that fails on its own is poison — drop it (never re-queue).
      logError("event_buffer_poison_row_dropped", err, {
        eventName: batch[0]?.eventName,
        projectId: batch[0]?.projectId,
      });
      return;
    }
    // Bisect and retry each half independently so healthy rows still land.
    const mid = Math.floor(batch.length / 2);
    await insertResilient(batch.slice(0, mid));
    await insertResilient(batch.slice(mid));
  }
}

async function flush() {
  if (buffer.length === 0) return;

  const batch = buffer;
  buffer = [];

  try {
    await db.insert(events).values(batch);
  } catch (err) {
    // A transient failure (e.g. DB blip) re-queues the batch to retry; a poison
    // row (permanent failure) is isolated via bisection so it can't wedge every
    // project's events until restart.
    console.error("[event-buffer] flush failed:", batch.length, "events:", err);
    let requeued = false;
    for (let attempt = 0; attempt < MAX_BATCH_RETRIES; attempt++) {
      try {
        await db.insert(events).values(batch);
        requeued = true;
        break;
      } catch {
        // fall through to bisection
      }
    }
    if (!requeued) {
      await insertResilient(batch);
    }
  }

  // Enforce the hard cap: if the live buffer grew past the ceiling while we were
  // flushing, drop the oldest overflow so memory stays bounded.
  if (buffer.length > MAX_BUFFER_CAP) {
    const dropped = buffer.length - MAX_BUFFER_CAP;
    buffer = buffer.slice(dropped);
    logWarn("event_buffer_overflow_dropped", { dropped, cap: MAX_BUFFER_CAP });
  }
}

export async function bufferEvents(rows: EventRow[]) {
  buffer.push(...rows);

  if (buffer.length >= MAX_BUFFER_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flush();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch((err) => console.error("[event-buffer] scheduled flush failed:", err));
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush any buffered events synchronously-ish (awaitable). Called on SIGTERM/
 * SIGINT so a deploy drains acknowledged-but-not-yet-written events instead of
 * losing them. There remains a narrow at-most-once window: events accepted (202)
 * in the milliseconds after this drain begins, or events lost if the process is
 * hard-killed (SIGKILL) before the DB write returns, are not recoverable.
 */
export async function drainBuffer(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}
