/**
 * The reference SDK.
 *
 * Every other language is asserted against the traces this one produces, so
 * what is decided here is decided for all four. The tests that matter most are
 * the ones about *not losing events* and *not double-counting them*.
 */

import { describe, expect, test } from "bun:test";
import {
  Counted,
  EventQueue,
  Visit,
  detectPlatform,
  type CountedOptions,
  type Diagnostic,
  type QueuedEvent,
} from "./index";

const NOW = Date.parse("2026-03-17T15:00:00.000Z");

type Capture = { requests: { body: string; headers: Record<string, string> }[] };

const responder = (
  capture: Capture,
  reply: (n: number) => Response,
): typeof fetch =>
  (async (_url: unknown, init: RequestInit) => {
    capture.requests.push({ body: String(init.body), headers: init.headers as Record<string, string> });
    return reply(capture.requests.length);
  }) as unknown as typeof fetch;

const accepted = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ accepted: 1, deduplicated: 0, rejected: 0, ...over }), { status: 202 });

const client = (capture: Capture, reply: (n: number) => Response, over: Partial<CountedOptions> = {}) => {
  const diagnostics: Diagnostic[] = [];
  const counted = new Counted({
    key: "ck_test",
    endpoint: "https://api.test/v1/events",
    flushIntervalMs: 0,
    now: () => NOW,
    fetch: responder(capture, reply),
    onDiagnostic: (d) => diagnostics.push(d),
    ...over,
  });
  return { counted, diagnostics };
};

const bodyOf = (capture: Capture, n = 0) =>
  JSON.parse(capture.requests[n]!.body) as { events: QueuedEvent[] };

describe("every event carries what makes a retry safe", () => {
  test("an idempotency key and an instant, both stamped at track time", async () => {
    // The server's dedup key is (key, instant). Regenerating either on retry
    // would double-count, which is what makes at-least-once delivery safe.
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.track("page_view");
    await counted.flush();

    const [event] = bodyOf(capture).events;
    expect(event!.idempotencyKey).toBeTruthy();
    expect(event!.occurredAt).toBe("2026-03-17T15:00:00.000Z");
  });

  test("a retried batch carries the identical key and instant", async () => {
    // The property the whole delivery model rests on.
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, (n) => (n === 1 ? new Response("", { status: 503 }) : accepted()));

    counted.track("page_view");
    await counted.flush();
    await counted.flush();

    expect(capture.requests).toHaveLength(2);
    const first = bodyOf(capture, 0).events[0]!;
    const second = bodyOf(capture, 1).events[0]!;
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.occurredAt).toBe(first.occurredAt);
  });

  test("two events never share a key", async () => {
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.track("a");
    counted.track("b");
    await counted.flush();

    const keys = bodyOf(capture).events.map((e) => e.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("identify", () => {
  test("events before identify carry no user", async () => {
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.track("page_view");
    await counted.flush();
    expect(bodyOf(capture).events[0]!.userId).toBeUndefined();
  });

  test("events after it carry the customer's own id", async () => {
    // The only way a durable identity enters Counted. Never derived, never
    // inferred, never invented.
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.identify("usr_42");
    counted.track("signup");
    await counted.flush();
    expect(bodyOf(capture).events[0]!.userId).toBe("usr_42");
  });

  test("reset forgets the person and starts a new visit", async () => {
    // Keeping the visit would group the next person's events with the last
    // one's, which looks like a privacy incident even with no identity.
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.identify("usr_42");
    counted.track("before");
    counted.reset();
    counted.track("after");
    await counted.flush();

    const [before, after] = bodyOf(capture).events;
    expect(before!.userId).toBe("usr_42");
    expect(after!.userId).toBeUndefined();
    expect(after!.visitId).not.toBe(before!.visitId);
  });

  test("an empty identify clears rather than setting an empty id", async () => {
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.identify("usr_1");
    counted.identify("   ");
    counted.track("x");
    await counted.flush();
    expect(bodyOf(capture).events[0]!.userId).toBeUndefined();
  });
});

describe("a refusal is not retried; a failure is", () => {
  test("a 503 returns the batch to the queue", async () => {
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, (n) => (n === 1 ? new Response("", { status: 503 }) : accepted()));
    counted.track("page_view");
    await counted.flush();
    await counted.flush();
    expect(capture.requests).toHaveLength(2);
  });

  test("a 400 with retryable false is dropped, not resent", async () => {
    // v1 retried any non-2xx, so a malformed batch was resent four times
    // unchanged and a revoked key was retried until the buffer filled.
    const capture: Capture = { requests: [] };
    const { counted, diagnostics } = client(capture, () =>
      new Response(JSON.stringify({ retryable: false, detail: "The body is not valid JSON." }), { status: 400 }),
    );
    counted.track("page_view");
    await counted.flush();
    await counted.flush();

    expect(capture.requests).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: "refused", status: 400 });
  });

  test("the server's own answer beats the status code", async () => {
    // A 500 the server calls permanent is permanent; a 400 it calls retryable
    // is retried. The envelope knows more than the number does.
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () =>
      new Response(JSON.stringify({ retryable: false, detail: "no" }), { status: 500 }),
    );
    counted.track("x");
    await counted.flush();
    await counted.flush();
    expect(capture.requests).toHaveLength(1);
  });

  test("a network error is retried, because nothing was heard back", async () => {
    const capture: Capture = { requests: [] };
    let calls = 0;
    const counted = new Counted({
      key: "ck",
      endpoint: "https://api.test/v1/events",
      flushIntervalMs: 0,
      now: () => NOW,
      fetch: (async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection reset");
        return accepted();
      }) as unknown as typeof fetch,
    });
    counted.track("x");
    await counted.flush();
    await counted.flush();
    expect(calls).toBe(2);
    expect(capture.requests).toHaveLength(0);
  });

  test("Retry-After pauses sending until it elapses", async () => {
    let clock = NOW;
    const capture: Capture = { requests: [] };
    const counted = new Counted({
      key: "ck",
      endpoint: "https://api.test/v1/events",
      flushIntervalMs: 0,
      now: () => clock,
      fetch: responder(capture, (n) =>
        n === 1 ? new Response("", { status: 429, headers: { "retry-after": "30" } }) : accepted(),
      ),
    });

    counted.track("x");
    await counted.flush();
    expect(capture.requests).toHaveLength(1);

    // Still inside the window: nothing is sent.
    clock += 10_000;
    await counted.flush();
    expect(capture.requests).toHaveLength(1);

    clock += 30_000;
    await counted.flush();
    expect(capture.requests).toHaveLength(2);
  });
});

describe("the receipt is read, not assumed", () => {
  test("rejected events are reported with their reasons", async () => {
    // v1's 202 had an empty body, so a rejected event and an accepted one
    // were byte-identical.
    const capture: Capture = { requests: [] };
    const { counted, diagnostics } = client(capture, () =>
      accepted({
        accepted: 0,
        rejected: 1,
        outcomes: [{ index: 0, accepted: false, reason: "An event name is required." }],
      }),
    );
    counted.track("");
    await counted.flush();

    expect(diagnostics.find((d) => d.kind === "rejected")).toMatchObject({
      events: 1,
      reasons: ["An event name is required."],
    });
  });

  test("an over-quota response is surfaced", async () => {
    const capture: Capture = { requests: [] };
    const { counted, diagnostics } = client(capture, () =>
      accepted({ quota: { state: "rejected", used: 120_000, limit: 100_000 } }),
    );
    counted.track("x");
    await counted.flush();
    expect(diagnostics.find((d) => d.kind === "quota")).toMatchObject({ state: "rejected" });
  });

  test("a clean receipt produces no diagnostics", async () => {
    const capture: Capture = { requests: [] };
    const { counted, diagnostics } = client(capture, () => accepted());
    counted.track("x");
    await counted.flush();
    expect(diagnostics).toEqual([]);
  });
});

describe("the queue is bounded, and says when it drops", () => {
  test("the cap is enforced on push, not only at flush", () => {
    // v1's cap was consulted inside flush(), so a hung server grew the buffer
    // without limit while the documented ceiling never applied.
    const queue = new EventQueue(3);
    for (let i = 0; i < 10; i++) {
      queue.push({ name: `e${i}`, visitId: "v", occurredAt: "t", idempotencyKey: `k${i}` });
    }
    expect(queue.size).toBe(3);
    expect(queue.droppedCount).toBe(7);
  });

  test("the oldest go first, so what just happened survives", () => {
    const queue = new EventQueue(2);
    for (const name of ["old", "middle", "new"]) {
      queue.push({ name, visitId: "v", occurredAt: "t", idempotencyKey: name });
    }
    expect(queue.take(10).map((e) => e.name)).toEqual(["middle", "new"]);
  });

  test("a requeued batch goes to the head, keeping order", () => {
    const queue = new EventQueue(10);
    queue.push({ name: "later", visitId: "v", occurredAt: "t", idempotencyKey: "b" });
    queue.requeue([{ name: "earlier", visitId: "v", occurredAt: "t", idempotencyKey: "a" }]);
    expect(queue.take(10).map((e) => e.name)).toEqual(["earlier", "later"]);
  });

  test("dropping is reported to the developer", async () => {
    const capture: Capture = { requests: [] };
    const { counted, diagnostics } = client(capture, () => accepted(), { maxQueueSize: 2 });
    for (let i = 0; i < 5; i++) counted.track(`e${i}`);
    expect(diagnostics.filter((d) => d.kind === "dropped").length).toBeGreaterThan(0);
  });
});

describe("the visit is ephemeral and never an identity", () => {
  test("it rolls over after the idle timeout", () => {
    let clock = NOW;
    const visit = new Visit({ idleMs: 1_000, now: () => clock });
    const first = visit.current();
    clock += 500;
    expect(visit.current()).toBe(first);
    clock += 2_000;
    expect(visit.current()).not.toBe(first);
  });

  test("activity keeps it alive", () => {
    let clock = NOW;
    const visit = new Visit({ idleMs: 1_000, now: () => clock });
    const first = visit.current();
    for (let i = 0; i < 5; i++) {
      clock += 800;
      expect(visit.current()).toBe(first);
    }
  });

  test("two clients do not share one", async () => {
    // v1's were module globals, so two instances interleaved events under one
    // id and clobbered each other's timeout.
    const capture: Capture = { requests: [] };
    const a = client(capture, () => accepted()).counted;
    const b = client(capture, () => accepted()).counted;
    a.track("x");
    b.track("y");
    await a.flush();
    await b.flush();
    expect(bodyOf(capture, 0).events[0]!.visitId).not.toBe(bodyOf(capture, 1).events[0]!.visitId);
  });
});

describe("the platform is the canonical value, not this runtime's word for it", () => {
  test("detection returns a value from the closed set", () => {
    // v1's four SDKs sent macOS, darwin, Mac OS X and macos, all into one
    // column, so a breakdown showed macOS four times.
    const platform = detectPlatform();
    expect([
      "macos", "windows", "linux", "ios", "ipados", "android",
      "tvos", "watchos", "visionos", "chromeos", "freebsd", "other",
    ]).toContain(platform);
  });

  test("a server runtime reports its own platform, not `other`", () => {
    // Bun and Deno define `navigator.userAgent` describing the runtime rather
    // than a browser. An implementation that checks for a user-agent to decide
    // "am I in a browser" reports `other` for every server-side event, which
    // is silently wrong rather than broken.
    expect(detectPlatform()).not.toBe("other");
  });

  test("a browser user-agent wins over the host platform", () => {
    // Order matters the other way too: a Next server render has both, and the
    // page's own events should say what the visitor is on.
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" },
      configurable: true,
    });
    try {
      // iPad before Macintosh: iPadOS sends a desktop Safari user-agent
      // containing both, and getting this wrong files iPad traffic as macOS.
      expect(detectPlatform()).toBe("ipados");
    } finally {
      if (original !== undefined) Object.defineProperty(globalThis, "navigator", original);
    }
  });

  test("it is sent with every event", async () => {
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.track("x");
    await counted.flush();
    expect(bodyOf(capture).events[0]!.systemProperties).toMatchObject({ sdk_version: "counted-js/2.0.0" });
  });
});

describe("shutdown", () => {
  test("it flushes what is queued", async () => {
    // For a script or a serverless handler, where the alternative is exiting
    // with events still in memory.
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.track("x");
    await counted.shutdown();
    expect(capture.requests).toHaveLength(1);
  });

  test("tracking after shutdown is ignored rather than queued forever", async () => {
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    await counted.shutdown();
    counted.track("x");
    await counted.flush();
    expect(capture.requests).toHaveLength(0);
  });
});

describe("concurrent flushes do not send the same batch twice", () => {
  test("overlapping calls join the one in flight", async () => {
    const capture: Capture = { requests: [] };
    const { counted } = client(capture, () => accepted());
    counted.track("a");
    counted.track("b");
    await Promise.all([counted.flush(), counted.flush(), counted.flush()]);
    expect(capture.requests).toHaveLength(1);
  });
});
