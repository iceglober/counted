import { describe, expect, test } from "bun:test";
import {
  Entitlement,
  Instant,
  MAX_BACKDATE_MS,
  MAX_CLOCK_SKEW_MS,
  MAX_EVENT_NAME_LENGTH,
  MAX_PROPERTIES,
  PLATFORMS,
  ProjectId,
  Quota,
  admit,
  explainRefusal,
  readPlatform,
  tally,
  type Disposition,
  type QuotaDecision,
  type SubmittedEvent,
} from "../index";

const PRJ = ProjectId("prj_1");
const t0 = Instant.fromEpochMillis(Date.parse("2026-03-17T14:37:00.000Z"));

const OK: QuotaDecision = Quota.decide(Entitlement.none(), { used: 0 });
const OVER: QuotaDecision = Quota.decide(Entitlement.none(), { used: 10_000_000 });

const event = (over: Partial<SubmittedEvent> = {}): SubmittedEvent => ({
  name: "page_view",
  visitId: "1720656000.k3j9x2mp",
  occurredAt: t0,
  ...over,
});

const run = (events: readonly SubmittedEvent[], quota: QuotaDecision = OK) =>
  admit({ project: PRJ, events, receivedAt: t0, quota });

const kindsOf = (d: readonly Disposition[]) => d.map((x) => x.kind);

describe("every submitted event gets a disposition", () => {
  test("one per event, in submission order, always", () => {
    // The receipt is built from this list, so a shorter one would silently
    // drop an event from the answer.
    const result = run([event(), event({ name: "" }), event()]);
    expect(result.dispositions).toHaveLength(3);
    expect(result.dispositions.map((d) => d.index)).toEqual([0, 1, 2]);
  });

  test("one bad event does not reject the batch", () => {
    // v1 validated the envelope and took the whole batch or none of it.
    const result = run([event(), event({ name: "   " }), event()]);
    expect(kindsOf(result.dispositions)).toEqual(["accepted", "rejected", "accepted"]);
    expect(result.admitted).toHaveLength(2);
  });

  test("the counts are derived from the list, so they cannot disagree with it", () => {
    const result = run([event(), event({ name: "" }), event({ visitId: "" })]);
    expect(tally(result.dispositions)).toEqual({ accepted: 1, dropped: 0, rejected: 2 });
  });

  test("an empty batch is an empty admission, not an error", () => {
    const result = run([]);
    expect(result.admitted).toHaveLength(0);
    expect(result.dispositions).toHaveLength(0);
  });
});

describe("over quota is its own outcome, never silent success", () => {
  test("events are dropped, and say so", () => {
    // v1 returned a byte-identical 202 past the hard limit and threw the
    // events away. A customer could be losing everything and see only success.
    const result = run([event(), event()], OVER);
    expect(kindsOf(result.dispositions)).toEqual(["dropped", "dropped"]);
    expect(result.admitted).toHaveLength(0);
    expect(tally(result.dispositions).dropped).toBe(2);
  });

  test("dropped is distinguishable from rejected", () => {
    // They need different fixes: one is a plan, the other is a payload.
    const result = run([event({ name: "" }), event()], OVER);
    expect(kindsOf(result.dispositions)).toEqual(["rejected", "dropped"]);
  });

  test("a malformed event is rejected even when over quota", () => {
    // Telling someone "over quota" for an event that could never be stored
    // sends them to fix the wrong thing.
    const result = run([event({ visitId: "" })], OVER);
    expect(result.dispositions[0]).toMatchObject({ kind: "rejected" });
  });

  test("overage still stores — that is the point of the band", () => {
    const overage = Quota.decide(Entitlement.none(), { used: 100_001 });
    expect(overage.kind).toBe("overage");
    const result = run([event()], overage);
    expect(kindsOf(result.dispositions)).toEqual(["accepted"]);
  });

  test("the quota decision travels with the admission, for the receipt", () => {
    expect(run([event()], OVER).quota).toBe(OVER);
  });
});

describe("identity arrives only from the customer", () => {
  test("no userId means a visit-only subject", () => {
    const [admitted] = run([event()]).admitted;
    expect(admitted!.subject.basis).toBe("visit");
  });

  test("a userId produces a person subject", () => {
    const [admitted] = run([event({ userId: "usr_42" })]).admitted;
    expect(admitted!.subject.basis).toBe("person");
  });

  test("an email address is refused, loudly", () => {
    // A customer who passes one has just put PII into a product whose entire
    // promise is that it holds none. Better to fail at the call site.
    const result = run([event({ userId: "someone@example.com" })]);
    expect(result.dispositions[0]).toMatchObject({
      kind: "rejected",
      reason: { code: "person_id_invalid", detail: "PersonIdLooksLikeEmail" },
    });
  });

  test("the refusal tells the customer what to send instead", () => {
    const message = explainRefusal({ code: "person_id_invalid", detail: "PersonIdLooksLikeEmail" });
    expect(message).toContain("opaque");
    expect(message).toContain("no personal data");
  });

  test("an over-long userId is refused rather than truncated", () => {
    const result = run([event({ userId: "u".repeat(300) })]);
    expect(result.dispositions[0]).toMatchObject({ kind: "rejected" });
  });
});

describe("dedup keys", () => {
  test("a supplied key is used verbatim", () => {
    const [admitted] = run([event({ idempotencyKey: "abc" })]).admitted;
    expect(admitted!.idempotencyKey).toBe("abc");
  });

  test("an absent key is derived from the event's own content", () => {
    // So a retry of the identical event produces the identical key and
    // deduplicates — which is what makes at-least-once delivery safe.
    const a = run([event({ properties: { path: "/pricing" } })]).admitted[0]!;
    const b = run([event({ properties: { path: "/pricing" } })]).admitted[0]!;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  test("the derived key is never null, so the unique index always applies", () => {
    for (const admitted of run([event(), event({ name: "signup" })]).admitted) {
      expect(admitted.idempotencyKey.length).toBeGreaterThan(0);
    }
  });

  test("different content derives different keys", () => {
    const a = run([event({ properties: { path: "/a" } })]).admitted[0]!;
    const b = run([event({ properties: { path: "/b" } })]).admitted[0]!;
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  test("property order does not change the derived key", () => {
    // Otherwise a client that serialises its object differently on retry
    // would double-count.
    const a = run([event({ properties: { a: 1, b: 2 } })]).admitted[0]!;
    const b = run([event({ properties: { b: 2, a: 1 } })]).admitted[0]!;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  test("a different instant derives a different key", () => {
    const later = Instant.fromEpochMillis(Instant.toEpochMillis(t0) - 1000);
    const a = run([event()]).admitted[0]!;
    const b = run([event({ occurredAt: later })]).admitted[0]!;
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
});

describe("timestamps", () => {
  test("an absent occurredAt defaults to arrival, and warns", () => {
    // Only right for events that did not sit in a queue, so it is warned
    // about rather than treated as equivalent.
    const result = run([event({ occurredAt: undefined })]);
    expect(result.admitted[0]!.occurredAt).toBe(t0);
    expect(result.warnings).toContainEqual({ index: 0, code: "occurred_at_missing" });
  });

  test("a supplied occurredAt is warning-free", () => {
    expect(run([event()]).warnings).toHaveLength(0);
  });

  test("a timestamp far in the future is refused", () => {
    // A device clock set to 2087 would otherwise poison every window query
    // that includes today.
    const future = Instant.fromEpochMillis(Instant.toEpochMillis(t0) + MAX_CLOCK_SKEW_MS + 1000);
    expect(run([event({ occurredAt: future })]).dispositions[0]).toMatchObject({
      kind: "rejected",
      reason: { code: "occurred_at_in_future" },
    });
  });

  test("small skew is tolerated — device clocks are never exact", () => {
    const slightly = Instant.fromEpochMillis(Instant.toEpochMillis(t0) + 30_000);
    expect(run([event({ occurredAt: slightly })]).dispositions[0]).toMatchObject({ kind: "accepted" });
  });

  test("a timestamp beyond the ingestion window is refused", () => {
    const ancient = Instant.fromEpochMillis(Instant.toEpochMillis(t0) - MAX_BACKDATE_MS - 1000);
    expect(run([event({ occurredAt: ancient })]).dispositions[0]).toMatchObject({
      kind: "rejected",
      reason: { code: "occurred_at_too_old" },
    });
  });

  test("a queued event from yesterday is fine", () => {
    // The whole point of the SDK's on-device queue.
    const yesterday = Instant.fromEpochMillis(Instant.toEpochMillis(t0) - 86_400_000);
    expect(run([event({ occurredAt: yesterday })]).dispositions[0]).toMatchObject({ kind: "accepted" });
  });
});

describe("the four-macOS bug is unrepresentable", () => {
  test("every spelling of macOS becomes one value", () => {
    // v1 stored whatever each SDK sent, so a breakdown showed macOS four
    // times with the traffic split between the spellings.
    for (const raw of ["macOS", "Mac OS X", "darwin", "macos", "MACOS", "mac-os-x"]) {
      expect(readPlatform(raw).platform).toBe("macos");
    }
  });

  test("the stored value is always in the closed set", () => {
    for (const raw of ["macOS", "Windows_NT", "wat", "", "Ubuntu 22.04"]) {
      expect(PLATFORMS).toContain(readPlatform(raw).platform);
    }
  });

  test("an unrecognised platform is kept raw, mapped to other, and warned about", () => {
    // So a platform we have never seen is discoverable rather than lost, and
    // the fix is a line in a table rather than a migration.
    const result = run([event({ systemProperties: { os_name: "PlayStation 6" } })]);
    const admitted = result.admitted[0]!;
    expect(admitted.system["os_name"]).toBe("other");
    expect(admitted.system["os_name_raw"]).toBe("PlayStation 6");
    expect(result.warnings).toContainEqual({
      index: 0,
      code: "platform_unrecognised",
      detail: "PlayStation 6",
    });
  });

  test("a recognised platform produces no warning", () => {
    const result = run([event({ systemProperties: { os_name: "darwin" } })]);
    expect(result.warnings).toHaveLength(0);
    expect(result.admitted[0]!.system["os_name"]).toBe("macos");
  });

  test("a missing platform is `other` with no raw and no warning", () => {
    // Absent is not the same as unrecognised; warning about it would be noise
    // on every server-side SDK.
    const result = run([event()]);
    expect(result.admitted[0]!.system["os_name"]).toBe("other");
    expect(result.admitted[0]!.system["os_name_raw"]).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  test("whitespace-only is treated as absent", () => {
    expect(readPlatform("   ")).toEqual({ platform: "other", raw: null, unrecognised: false });
  });
});

describe("event shape", () => {
  test("an empty or whitespace name is refused", () => {
    for (const name of ["", "   "]) {
      expect(run([event({ name })]).dispositions[0]).toMatchObject({
        kind: "rejected",
        reason: { code: "name_empty" },
      });
    }
  });

  test("names are trimmed, so `signup` and ` signup ` are one event", () => {
    expect(run([event({ name: "  signup  " })]).admitted[0]!.name).toBe("signup");
  });

  test("an over-long name is refused with the numbers in it", () => {
    const result = run([event({ name: "x".repeat(MAX_EVENT_NAME_LENGTH + 1) })]);
    expect(result.dispositions[0]).toMatchObject({
      kind: "rejected",
      reason: { code: "name_too_long", max: MAX_EVENT_NAME_LENGTH },
    });
  });

  test("a missing visit is refused", () => {
    expect(run([event({ visitId: "  " })]).dispositions[0]).toMatchObject({
      kind: "rejected",
      reason: { code: "visit_missing" },
    });
  });

  test("too many properties is refused, with the count", () => {
    const properties = Object.fromEntries(Array.from({ length: MAX_PROPERTIES + 1 }, (_, i) => [`k${i}`, i]));
    expect(run([event({ properties })]).dispositions[0]).toMatchObject({
      kind: "rejected",
      reason: { code: "too_many_properties", count: MAX_PROPERTIES + 1 },
    });
  });

  test("every refusal explains itself in one sentence", () => {
    const reasons = [
      { code: "name_empty" },
      { code: "name_too_long", length: 300, max: 200 },
      { code: "visit_missing" },
      { code: "too_many_properties", count: 60, max: 50 },
      { code: "person_id_invalid", detail: "PersonIdRequired" },
      { code: "occurred_at_in_future", skewMs: 600_000 },
      { code: "occurred_at_too_old", ageMs: 100 * 86_400_000 },
    ] as const;
    for (const reason of reasons) {
      const text = explainRefusal(reason);
      expect(text.length).toBeGreaterThan(10);
      expect(text.endsWith(".")).toBe(true);
    }
  });
});

describe("admission is pure", () => {
  test("the same input gives the same output, with no clock anywhere", () => {
    // No `Date.now()` in the domain — `receivedAt` is passed in. That is why
    // the whole of ingestion's logic is testable without a server.
    const events = [event(), event({ name: "" }), event({ userId: "u1" })];
    expect(JSON.stringify(run(events))).toBe(JSON.stringify(run(events)));
  });

  test("the input is not mutated", () => {
    const events = [event({ systemProperties: { os_name: "darwin" } })];
    const before = JSON.stringify(events);
    run(events);
    expect(JSON.stringify(events)).toBe(before);
  });
});

describe("the agent vocabulary is enforced at ingest, not only in the SDK", () => {
  // The SDK validates too, on the developer's machine, where a wrong event
  // fails next to the line that wrote it. But a check only the SDK performs is
  // a check that an old client, a curl, or somebody's own script skips — and
  // the agent dashboards are built on these names meaning exactly one thing.
  // Both sides read the same generated module, so they cannot disagree about
  // what is valid.

  const reasonOf = (d: Disposition): string =>
    d.kind === "rejected" ? d.reason.code : d.kind;

  test("a valid agent event is admitted", () => {
    const result = run([
      event({ name: "agent_tool_use", properties: { tool: "Bash", outcome: "success" } }),
    ]);
    expect(kindsOf(result.dispositions)).toEqual(["accepted"]);
  });

  test("an invented agent_ name is rejected", () => {
    // Storing it would put a series in the agent dashboards that no host emits.
    const result = run([event({ name: "agent_vibes", properties: {} })]);
    expect(reasonOf(result.dispositions[0]!)).toBe("agent_vocabulary");
    expect(result.admitted).toEqual([]);
  });

  test("a known agent event with the wrong properties is rejected", () => {
    const result = run([event({ name: "agent_tool_use", properties: { tool: "Bash" } })]);
    expect(reasonOf(result.dispositions[0]!)).toBe("agent_vocabulary");
  });

  test("an enum outside its values is rejected", () => {
    const result = run([
      event({ name: "agent_tool_use", properties: { tool: "Bash", outcome: "maybe" } }),
    ]);
    expect(reasonOf(result.dispositions[0]!)).toBe("agent_vocabulary");
  });

  test("the refusal says what was wrong with it", () => {
    const result = run([event({ name: "agent_file_edit", properties: { path: "a.ts" } })]);
    const disposition = result.dispositions[0]!;
    if (disposition.kind !== "rejected") throw new Error("expected a rejection");
    expect(explainRefusal(disposition.reason)).toContain("action is required");
  });

  test("a customer's own event is never held to it", () => {
    // The prefix is the claim. A product that validated its customers' event
    // names would be refusing the data it is paid to store.
    const result = run([
      event({ name: "session_start", properties: { anything: "goes" } }),
      event({ name: "checkout_completed", properties: { total: 42 } }),
    ]);
    expect(kindsOf(result.dispositions)).toEqual(["accepted", "accepted"]);
  });

  test("one bad agent event does not reject the batch", () => {
    const result = run([
      event({ name: "agent_tool_use", properties: { tool: "Bash", outcome: "success" } }),
      event({ name: "agent_nope", properties: {} }),
      event({ name: "checkout_completed", properties: {} }),
    ]);
    expect(kindsOf(result.dispositions)).toEqual(["accepted", "rejected", "accepted"]);
  });
});
