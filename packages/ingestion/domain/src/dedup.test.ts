import { describe, expect, test } from "bun:test";

import { Duration, Instant, ProjectId, WorkspaceId, isOk } from "@counted/kernel";

import { admit } from "./admission";
import type { IngestBatch, RawEvent } from "./batch";
import { collapseDuplicates, dedupKey, type DedupKey } from "./dedup";

const AT = Instant.fromEpochMillis(Date.UTC(2026, 7, 30, 12, 0, 0));
const LATER = Instant.plus(AT, Duration.seconds(1));

const keyed = (key: string | null) => ({ dedupKey: key as DedupKey | null });

describe("the dedup key is the pair, not the id", () => {
  test("the same key at the same instant is the same event", () => {
    expect(dedupKey("abc", AT)).toBe(dedupKey("abc", AT));
  });

  test("the same key at a different instant is a different event", () => {
    // A client whose key generator collides — a random suffix, a counter that
    // resets on restart — would otherwise have real events silently swallowed.
    expect(dedupKey("abc", AT)).not.toBe(dedupKey("abc", LATER));
  });

  test("different keys at the same instant are different events", () => {
    expect(dedupKey("abc", AT)).not.toBe(dedupKey("abd", AT));
  });

  test("the two halves cannot be confused for one another", () => {
    // Naive concatenation makes ("ab", 1) and ("a", 1) collide once "b1" and
    // "b" "1" meet. The separator is what stops that.
    expect(dedupKey("ab", Instant.fromEpochMillis(1))).not.toBe(dedupKey("a", Instant.fromEpochMillis(1)));
  });
});

describe("collapseDuplicates", () => {
  test("keeps the first occurrence and counts what it dropped", () => {
    const result = collapseDuplicates([keyed("a"), keyed("b"), keyed("a"), keyed("a")]);
    expect(result.unique.map((e) => e.dedupKey)).toEqual(["a", "b"] as DedupKey[]);
    expect(result.duplicates).toBe(2);
  });

  test("keeps the first rather than the last, so a retry does not reorder", () => {
    const first = { dedupKey: "a" as DedupKey, tag: "first" };
    const second = { dedupKey: "a" as DedupKey, tag: "second" };
    expect(collapseDuplicates([first, { dedupKey: "b" as DedupKey, tag: "b" }, second]).unique[0]).toBe(first);
  });

  test("an event with no key is never a duplicate of anything", () => {
    // Opting out of dedup is what a curl client or a compatibility shim does.
    // It gets at-least-once with no collapse, which is the honest answer.
    const result = collapseDuplicates([keyed(null), keyed(null), keyed(null)]);
    expect(result.unique).toHaveLength(3);
    expect(result.duplicates).toBe(0);
  });

  test("keys already seen elsewhere collapse against that set", () => {
    // This is how a request joining an in-flight group is deduplicated against
    // what is already buffered, not just against itself.
    const seen = new Set<DedupKey>(["a" as DedupKey]);
    const result = collapseDuplicates([keyed("a"), keyed("c")], seen);
    expect(result.unique.map((e) => e.dedupKey)).toEqual(["c"] as DedupKey[]);
    expect(result.duplicates).toBe(1);
  });

  test("the caller's `seen` set is not mutated", () => {
    const seen = new Set<DedupKey>(["a" as DedupKey]);
    collapseDuplicates([keyed("b")], seen);
    expect(seen.size).toBe(1);
  });
});

describe("a resent batch", () => {
  const batchOf = (events: readonly RawEvent[]): IngestBatch => ({
    workspace: WorkspaceId("ws_1"),
    project: ProjectId("prj_1"),
    receivedAt: AT,
    events,
    country: null,
    bytes: null,
  });

  const event = (key: string, occurredAt: Instant): RawEvent => ({
    name: "checkout_completed",
    visitId: "1770000000.abcd1234",
    occurredAt: Instant.toISO(occurredAt),
    idempotencyKey: key,
  });

  test("the retry of a batch admits the same events, so the sink can recognise them", () => {
    const body = [event("k1", AT), event("k2", AT)];

    const first = admit(batchOf(body));
    const retry = admit(batchOf(body));
    if (!isOk(first) || !isOk(retry)) throw new Error("expected Ok");

    expect(retry.value.admitted.map((e) => e.dedupKey)).toEqual(first.value.admitted.map((e) => e.dedupKey));
  });

  test("a client that re-stamps the timestamp on retry double-counts, and that is its bug not ours", () => {
    // SDK-011 exists because of this. Stated as a test so the reason the
    // instant is in the key is not lost the next time somebody simplifies it.
    const first = admit(batchOf([event("k1", AT)]));
    const restamped = admit(batchOf([event("k1", LATER)]));
    if (!isOk(first) || !isOk(restamped)) throw new Error("expected Ok");

    expect(restamped.value.admitted[0]?.dedupKey).not.toBe(first.value.admitted[0]?.dedupKey as DedupKey);
  });

  test("duplicates inside one batch are collapsed and reported", () => {
    const result = admit(batchOf([event("k1", AT), event("k1", AT), event("k2", AT)]));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.admitted).toHaveLength(2);
    expect(result.value.duplicates).toBe(1);
  });
});
