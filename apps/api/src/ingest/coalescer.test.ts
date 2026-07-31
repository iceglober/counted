/**
 * Group commit.
 *
 * These are the tests that make "202 means committed" a checkable claim rather
 * than a comment. v1's buffer had a comment saying failed batches were
 * re-queued; they were not, and no test could have caught it because there was
 * no boundary to test.
 */

import { describe, expect, test } from "bun:test";
import { Instant, ProjectId, VisitId } from "@counted/domain";
import type { AppendReceipt, EventWriter, WritableEvent } from "@counted/ports";
import { Coalescer, QueueFullError, dedupIdentity } from "./coalescer";

const PRJ = ProjectId("prj_1");
const t0 = Instant.fromEpochMillis(1_700_000_000_000);

const row = (key: string): WritableEvent => ({
  project: PRJ,
  name: "page_view",
  occurredAt: t0,
  visit: VisitId("v1"),
  person: null,
  idempotencyKey: key,
  properties: {},
  system: {},
});

/** A writer whose commit a test controls explicitly. */
const controllable = () => {
  const calls: (readonly WritableEvent[])[] = [];
  let release: ((r: AppendReceipt) => void) | null = null;
  let fail: ((e: unknown) => void) | null = null;

  const writer: EventWriter = {
    append: async (events) => {
      calls.push(events);
      return new Promise<AppendReceipt>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
    },
  };

  return {
    writer,
    calls,
    commit: (events: readonly WritableEvent[]) =>
      release!({
        accepted: events.length,
        deduplicated: 0,
        written: events.map((e) => ({ idempotencyKey: e.idempotencyKey, occurredAt: e.occurredAt })),
        committedAt: t0,
      }),
    commitPartial: (written: readonly WritableEvent[]) =>
      release!({
        accepted: written.length,
        deduplicated: 0,
        written: written.map((e) => ({ idempotencyKey: e.idempotencyKey, occurredAt: e.occurredAt })),
        committedAt: t0,
      }),
    reject: (e: unknown) => fail!(e),
  };
};

/** A writer that commits immediately, echoing everything as newly written. */
const instant = (): EventWriter => ({
  append: async (events) => ({
    accepted: events.length,
    deduplicated: 0,
    written: events.map((e) => ({ idempotencyKey: e.idempotencyKey, occurredAt: e.occurredAt })),
    committedAt: t0,
  }),
});

const settled = async (p: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void p.then(() => { done = true; }, () => { done = true; });
  // Two turns of the microtask queue is enough for anything already resolved.
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

describe("a caller waits for its own batch to commit", () => {
  test("the promise does not settle before the write does", async () => {
    // This is the entire difference from v1, which returned 202 from an
    // in-memory array and flushed on a timer.
    const w = controllable();
    const coalescer = new Coalescer(w.writer, { windowMs: 0, schedule: (fn) => fn() });

    const pending = coalescer.submit([row("a")]);
    expect(await settled(pending)).toBe(false);

    w.commit([row("a")]);
    await pending;
    expect(await settled(pending)).toBe(true);
  });

  test("the committedAt it reports is the writer's, not a guess", async () => {
    const coalescer = new Coalescer(instant(), { windowMs: 0, schedule: (fn) => fn() });
    const result = await coalescer.submit([row("a")]);
    expect(result.committedAt).toBe(t0);
  });
});

describe("concurrent requests share one write", () => {
  test("three submissions in the same window become one append", async () => {
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: (fn) => { flush = fn; } });

    const a = coalescer.submit([row("a")]);
    const b = coalescer.submit([row("b")]);
    const c = coalescer.submit([row("c")]);

    flush!();
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]).toHaveLength(3);

    w.commit([row("a"), row("b"), row("c")]);
    await Promise.all([a, b, c]);
  });

  test("every caller in the batch is answered", async () => {
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: (fn) => { flush = fn; } });

    const promises = [coalescer.submit([row("a")]), coalescer.submit([row("b")])];
    flush!();
    w.commit([row("a"), row("b")]);

    const results = await Promise.all(promises);
    expect(results).toHaveLength(2);
    for (const r of results) expect(r.committedAt).toBe(t0);
  });

  test("a full batch flushes early rather than waiting out the window", async () => {
    const w = controllable();
    // No scheduled flush at all: only the row cap can trigger this one.
    const coalescer = new Coalescer(w.writer, { maxRows: 2, schedule: () => {} });

    void coalescer.submit([row("a")]).catch(() => {});
    expect(w.calls).toHaveLength(0);
    void coalescer.submit([row("b")]).catch(() => {});
    expect(w.calls).toHaveLength(1);
  });

  test("rows submitted during a write join the next batch, not the one in flight", async () => {
    // Otherwise a caller could be answered by a commit that did not include
    // its rows — the exact lie this design exists to remove.
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: (fn) => { flush = fn; } });

    void coalescer.submit([row("a")]).catch(() => {});
    flush!();
    expect(w.calls[0]).toHaveLength(1);

    void coalescer.submit([row("b")]).catch(() => {});
    // Still one call: `b` opened a new batch rather than joining the one that
    // is already being written.
    expect(w.calls).toHaveLength(1);
  });
});

describe("a failure reaches every caller", () => {
  test("all promises in the batch reject", async () => {
    // v1 dropped the batch and told nobody, while its own comment claimed
    // failed batches were re-queued.
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: (fn) => { flush = fn; } });

    // Handlers attached before the rejection, so the failure under test is
    // the coalescer's behaviour and not an unhandled-rejection race.
    const a = coalescer.submit([row("a")]);
    const b = coalescer.submit([row("b")]);
    const settledA = a.then(() => "resolved", (e: Error) => e.message);
    const settledB = b.then(() => "resolved", (e: Error) => e.message);

    flush!();
    w.reject(new Error("connection reset"));

    expect(await settledA).toBe("connection reset");
    expect(await settledB).toBe("connection reset");
  });

  test("a failed batch does not leave rows counted as pending forever", async () => {
    // Otherwise a few failures would fill the queue and refuse everything.
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: (fn) => { flush = fn; } });

    const a = coalescer.submit([row("a")]);
    const settledA = a.catch(() => "failed");
    flush!();
    w.reject(new Error("nope"));
    expect(await settledA).toBe("failed");

    expect(coalescer.pendingRows()).toBe(0);
  });

  test("the coalescer keeps working after a failure", async () => {
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: (fn) => { flush = fn; } });

    const failed = coalescer.submit([row("a")]);
    const settledFailed = failed.catch(() => "failed");
    flush!();
    w.reject(new Error("nope"));
    expect(await settledFailed).toBe("failed");

    const next = coalescer.submit([row("b")]);
    flush!();
    w.commit([row("b")]);
    expect((await next).written.size).toBe(1);
  });
});

describe("admission is bounded", () => {
  test("past the cap, submissions are refused rather than queued", async () => {
    // A full queue is backpressure, not storage. v1 checked its cap only
    // inside flush(), so a hung database grew the buffer without limit while
    // the documented 50,000 ceiling never applied.
    const w = controllable();
    const coalescer = new Coalescer(w.writer, { maxPending: 2, schedule: () => {} });

    void coalescer.submit([row("a"), row("b")]).catch(() => {});
    await expect(coalescer.submit([row("c")])).rejects.toThrow(QueueFullError);
  });

  test("the refusal is marked retryable, because it is", async () => {
    const coalescer = new Coalescer(controllable().writer, { maxPending: 1, schedule: () => {} });
    void coalescer.submit([row("a")]).catch(() => {});
    try {
      await coalescer.submit([row("b")]);
      throw new Error("expected a refusal");
    } catch (e) {
      expect(e).toBeInstanceOf(QueueFullError);
      expect((e as QueueFullError).retryable).toBe(true);
    }
  });

  test("the cap is checked on the way in, not at flush time", async () => {
    // The distinction that matters: a cap enforced only at flush does nothing
    // at all while the database is hung, which is exactly when it is needed.
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { maxPending: 3, windowMs: 20, schedule: (fn) => { flush = fn; } });

    void coalescer.submit([row("a")]).catch(() => {});
    flush!(); // in flight, never committed — the hung-database case
    void coalescer.submit([row("b")]).catch(() => {});
    void coalescer.submit([row("c")]).catch(() => {});
    await expect(coalescer.submit([row("d")])).rejects.toThrow(QueueFullError);
  });

  test("committed rows free their space", async () => {
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { maxPending: 2, windowMs: 20, schedule: (fn) => { flush = fn; } });

    const a = coalescer.submit([row("a"), row("b")]);
    flush!();
    w.commit([row("a"), row("b")]);
    await a;

    expect(coalescer.pendingRows()).toBe(0);
    // Space freed: this submission is accepted rather than refused.
    const next = coalescer.submit([row("c")]);
    void next.catch(() => {});
    expect(coalescer.pendingRows()).toBe(1);
  });
});

describe("which rows were actually written", () => {
  test("the result names them, so a receipt can say deduplicated per event", () => {
    expect(dedupIdentity(row("abc"))).toContain("abc");
  });

  test("a row the writer did not return is a duplicate", async () => {
    const w = controllable();
    let flush: (() => void) | null = null;
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: (fn) => { flush = fn; } });

    const submitted = coalescer.submit([row("new"), row("already-there")]);
    flush!();
    // The RETURNING set from ON CONFLICT DO NOTHING: only the new row.
    w.commitPartial([row("new")]);

    const result = await submitted;
    expect(result.written.has(dedupIdentity(row("new")))).toBe(true);
    expect(result.written.has(dedupIdentity(row("already-there")))).toBe(false);
  });
});

describe("an empty submission", () => {
  test("returns immediately without opening a batch", async () => {
    // A batch whose every event was rejected or dropped still needs a
    // receipt, and must not wait on a commit that will never happen.
    const w = controllable();
    const coalescer = new Coalescer(w.writer, { windowMs: 20, schedule: () => {} });

    const result = await coalescer.submit([]);
    expect(result.written.size).toBe(0);
    expect(w.calls).toHaveLength(0);
  });
});
