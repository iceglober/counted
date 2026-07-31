/**
 * Sending an import, and reading what came back.
 *
 * The v1 importer posted to `/api/v0/event` and treated any 2xx as done. For a
 * one-shot history import that is the worst failure available: the tool prints
 * "Migration complete" over a silent gap, and nobody notices until they look
 * at last year's numbers.
 *
 * So most of what is tested here is the receipt — that nothing is reported as
 * imported unless the server said so, and that a refusal is loud.
 */

import { describe, expect, test } from "bun:test";
import {
  emptyTally,
  exhausted,
  importKey,
  record,
  retryAfterMs,
  sendBatch,
  summarize,
  type CountedEvent,
  type Receipt,
} from "./target";

const event = (over: Partial<CountedEvent> = {}): CountedEvent => ({
  name: "app_started",
  visitId: "s-1",
  occurredAt: "2026-01-01T00:00:00.000Z",
  idempotencyKey: "import:abc",
  ...over,
});

const server = (respond: (body: string) => Response) => {
  const sent: unknown[] = [];
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return respond(String(init.body));
  }) as unknown as typeof fetch;
  return { sent, deps: { endpoint: "https://api.counted.test/v1/events", key: "ck_x", fetch: fetchImpl } };
};

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  accepted: 1,
  deduplicated: 0,
  rejected: 0,
  ...over,
});

const json = (body: unknown, status = 202): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the wire", () => {
  test("it posts to /v1/events with a bearer key", async () => {
    const captured: Headers[] = [];
    const fetchImpl = (async (url: unknown, init: RequestInit) => {
      captured.push(new Headers(init.headers as HeadersInit));
      expect(String(url)).toBe("https://api.counted.test/v1/events");
      return json(receipt());
    }) as unknown as typeof fetch;

    await sendBatch([event()], { endpoint: "https://api.counted.test/v1/events", key: "ck_live_x", fetch: fetchImpl });
    expect(captured[0]?.get("authorization")).toBe("Bearer ck_live_x");
  });

  test("events go in the v1 envelope, not Aptabase's", async () => {
    const { sent, deps } = server(() => json(receipt()));
    await sendBatch([event()], deps);

    const body = sent[0] as { events: Record<string, unknown>[] };
    expect(body.events[0]).toMatchObject({ name: "app_started", visitId: "s-1", idempotencyKey: "import:abc" });
    // Their names stop at the reader.
    expect(JSON.stringify(body)).not.toContain("eventName");
    expect(JSON.stringify(body)).not.toContain("systemProps\"");
  });
});

describe("the receipt is read, not assumed", () => {
  test("a 2xx without a receipt is refused rather than reported as success", async () => {
    // Exactly the v1 bug: a status code is not a report of what was stored.
    const { deps } = server(() => new Response("", { status: 202 }));
    const outcome = await sendBatch([event()], deps);
    expect(outcome).toMatchObject({ kind: "refused" });
  });

  test("what the server says is what gets counted", async () => {
    const { deps } = server(() => json(receipt({ accepted: 8, deduplicated: 2, rejected: 0 })));
    const outcome = await sendBatch([event()], deps);
    if (outcome.kind !== "sent") throw new Error("expected a receipt");

    const tally = record(emptyTally(), outcome.receipt);
    // Ten events were sent; eight were stored. The tool reports eight.
    expect(tally).toMatchObject({ accepted: 8, deduplicated: 2 });
  });

  test("refusals are grouped by reason, not listed per event", async () => {
    // One line per event is unreadable at import scale, and unreadable output
    // is output nobody acts on.
    const tally = record(
      emptyTally(),
      receipt({
        accepted: 1,
        rejected: 3,
        outcomes: [
          { index: 0, accepted: true, deduplicated: false },
          { index: 1, accepted: false, reason: "occurredAt is 400 days old, beyond the ingestion window." },
          { index: 2, accepted: false, reason: "occurredAt is 400 days old, beyond the ingestion window." },
          { index: 3, accepted: false, reason: "An event name is required." },
        ],
      }),
    );

    expect(tally.reasons.get("occurredAt is 400 days old, beyond the ingestion window.")).toBe(2);
    expect(tally.reasons.get("An event name is required.")).toBe(1);
  });
});

describe("retrying", () => {
  test("a network failure is retryable, because nothing was answered", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const outcome = await sendBatch([event()], { endpoint: "https://x/v1/events", key: "k", fetch: fetchImpl });
    expect(outcome).toMatchObject({ kind: "retry" });
  });

  test("the server's own retryable flag wins over the status list", async () => {
    // A 400 the server says is retryable is retryable; guessing from the code
    // would send the import into a loop or stop it needlessly.
    const { deps } = server(() =>
      new Response(JSON.stringify({ detail: "try again", retryable: true }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await sendBatch([event()], deps)).toMatchObject({ kind: "retry" });
  });

  test("a 4xx the server does not excuse is refused, not looped", async () => {
    const { deps } = server(() =>
      new Response(JSON.stringify({ detail: "This credential may not write events." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const outcome = await sendBatch([event()], deps);
    expect(outcome).toMatchObject({ kind: "refused", status: 403 });
    if (outcome.kind === "refused") expect(outcome.detail).toContain("may not write events");
  });

  test("Retry-After is honoured in both forms", () => {
    expect(retryAfterMs("30")).toBe(30_000);
    expect(retryAfterMs(null)).toBeNull();
    // Unparseable means "fall back to our own backoff", not "wait NaN".
    expect(retryAfterMs("soon")).toBeNull();
  });
});

describe("the import key", () => {
  test("the same source row produces the same key, every run", () => {
    // What makes a resume exact rather than "an accepted, small overlap" — the
    // phrase the v1 importer used, because it had no key at all.
    expect(importKey(["s-1", "app_started", "2026-01-01T00:00:00.000Z"])).toBe(
      importKey(["s-1", "app_started", "2026-01-01T00:00:00.000Z"]),
    );
  });

  test("different rows produce different keys", () => {
    expect(importKey(["s-1", "app_started", "2026-01-01T00:00:00.000Z"])).not.toBe(
      importKey(["s-2", "app_started", "2026-01-01T00:00:00.000Z"]),
    );
  });

  test("it is marked as an import, so it is distinguishable from a live event", () => {
    expect(importKey(["a"]).startsWith("import:")).toBe(true);
  });
});

describe("quota", () => {
  test("a rejected quota stops the import", () => {
    // Every remaining batch would be refused identically. Continuing wastes
    // the user's time and fills the terminal with one message.
    const tally = record(emptyTally(), receipt({ quota: { state: "rejected", used: 100_000, limit: 100_000 } }));
    expect(exhausted(tally)).toBe(true);
  });

  test("overage does not, because those events are stored", () => {
    const tally = record(emptyTally(), receipt({ quota: { state: "overage", used: 120_000, limit: 100_000 } }));
    expect(exhausted(tally)).toBe(false);
  });
});

describe("the summary", () => {
  test("reports imported and already-there separately", () => {
    // "Already there" is a success — it means the resume worked — and folding
    // it into "imported" would overstate what this run did.
    const tally = record(emptyTally(), receipt({ accepted: 900, deduplicated: 100 }));
    const text = summarize(tally);
    expect(text).toContain("Imported:      900");
    expect(text).toContain("Already there: 100");
  });

  test("names refusals with their counts", () => {
    const tally = record(
      emptyTally(),
      receipt({ accepted: 0, rejected: 2, outcomes: [
        { index: 0, accepted: false, reason: "An event name is required." },
        { index: 1, accepted: false, reason: "An event name is required." },
      ] }),
    );
    expect(summarize(tally)).toContain("2 × An event name is required.");
  });

  test("says nothing about refusals when there were none", () => {
    expect(summarize(record(emptyTally(), receipt({ accepted: 5 })))).not.toContain("Refused");
  });
});
