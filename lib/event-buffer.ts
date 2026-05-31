import { db } from "./db";
import { events } from "./db/schema";

type EventRow = typeof events.$inferInsert;

let buffer: EventRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 200;

async function flush() {
  if (buffer.length === 0) return;

  const batch = buffer;
  buffer = [];

  try {
    await db.insert(events).values(batch);
  } catch (err) {
    console.error("[event-buffer] flush failed, re-queuing", batch.length, "events:", err);
    buffer.unshift(...batch);
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
