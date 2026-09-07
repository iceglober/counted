import { describe, expect, test } from "bun:test";

import { Duration, Instant, ProjectId, WorkspaceId, isErr, isOk } from "@counted/kernel";

import { admit, admitEvent, DEFAULT_ADMISSION_POLICY, type AdmissionPolicy } from "./admission";
import { admitCountry, type CountryCode } from "./country";
import type { IngestBatch, RawEvent } from "./batch";

const AT = Instant.fromEpochMillis(Date.UTC(2026, 7, 30, 12, 0, 0));

const batchOf = (events: readonly RawEvent[], overrides: Partial<IngestBatch> = {}): IngestBatch => ({
  workspace: WorkspaceId("ws_1"),
  project: ProjectId("prj_1"),
  receivedAt: AT,
  events,
  // The default is "we could not place the caller". Tests that care about
  // geography say so; the rest must not silently get a country.
  country: null,
  bytes: null,
  ...overrides,
});

const anEvent = (overrides: Partial<RawEvent> = {}): RawEvent => ({
  name: "checkout_completed",
  visitId: "1770000000.abcd1234",
  occurredAt: Instant.toISO(AT),
  idempotencyKey: "k1",
  ...overrides,
});

const admitOne = (raw: RawEvent, policy: AdmissionPolicy = DEFAULT_ADMISSION_POLICY) =>
  admitEvent(raw, 0, batchOf([raw]), policy);

describe("the batch is refused as a whole, or not at all", () => {
  test("too many events refuses the batch and nothing lands", () => {
    const events = Array.from({ length: DEFAULT_ADMISSION_POLICY.maxEventsPerBatch + 1 }, () => anEvent());
    const result = admit(batchOf(events));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        kind: "BatchTooLarge",
        count: DEFAULT_ADMISSION_POLICY.maxEventsPerBatch + 1,
        max: DEFAULT_ADMISSION_POLICY.maxEventsPerBatch,
      });
    }
  });

  test("a body over the size cap refuses the batch", () => {
    const result = admit(batchOf([anEvent()], { bytes: 2_000_000 }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("PayloadTooLarge");
  });

  test("an unmeasured body is not a reason to refuse", () => {
    expect(isOk(admit(batchOf([anEvent()], { bytes: null })))).toBe(true);
  });

  test("an empty batch is accepted — a client flushing nothing is not an error", () => {
    const result = admit(batchOf([]));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toEqual({ admitted: [], rejected: [], duplicates: 0 });
  });
});

describe("one bad event does not cost the batch", () => {
  test("the good events land and the bad one is named by index", () => {
    const result = admit(batchOf([anEvent(), anEvent({ name: 42 }), anEvent({ idempotencyKey: "k3" })]));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // The failure this prevents: all-or-nothing means one typo costs
    // forty-nine good events, and the client cannot tell which they were.
    expect(result.value.admitted).toHaveLength(2);
    expect(result.value.rejected).toEqual([
      { index: 1, error: { kind: "MalformedEvent", index: 1, detail: "name is required" } },
    ]);
  });

  test("indexes are the client's, not the survivors'", () => {
    const result = admit(batchOf([anEvent({ name: "" }), anEvent(), anEvent({ visitId: "" })]));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.rejected.map((r) => r.index)).toEqual([0, 2]);
  });
});

describe("names", () => {
  test("a customer's own event needs no permission from a vocabulary", () => {
    expect(isOk(admitOne(anEvent({ name: "whatever_they_like" })))).toBe(true);
  });

  test("whitespace in a name is refused rather than trimmed", () => {
    // Trimming would leave `" checkout"` and `"checkout"` as one event in the
    // API and two in nobody's mental model. Refusing tells the developer.
    const result = admitOne(anEvent({ name: " checkout " }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("MalformedEvent");
  });

  test("an unknown agent event is refused by name, not as malformed", () => {
    const result = admitOne(anEvent({ name: "agent_vibes" }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toEqual({ kind: "UnknownEventName", name: "agent_vibes" });
  });

  test("a known agent event still has to satisfy the generated vocabulary", () => {
    const result = admitOne(anEvent({ name: "agent_tool_use", properties: { tool: "Bash" } }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("MalformedEvent");
  });

  test("the session context the tracker stamps on every event is not mistaken for a property", () => {
    // agent-core sends `{ ...context, ...properties }` flat on the wire. Held
    // to the event's own field list, every agent event ever sent would be
    // refused for carrying `setupHash`.
    const result = admitOne(
      anEvent({
        name: "agent_tool_use",
        properties: {
          tool: "Bash",
          outcome: "success",
          setupHash: "abc",
          setupSpec: "counted.setup/1",
          setupHostSpec: "claude-code",
        },
      }),
    );
    expect(isOk(result)).toBe(true);
  });
});

describe("time", () => {
  test("an absent timestamp is stamped on arrival", () => {
    const result = admitOne(anEvent({ occurredAt: undefined }));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.occurredAt).toBe(AT);
  });

  test("epoch millis are accepted, because the compatibility shim sends them", () => {
    const result = admitOne(anEvent({ occurredAt: Instant.toEpochMillis(AT) }));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.occurredAt).toBe(AT);
  });

  test("a clock far ahead is refused rather than clamped", () => {
    // Clamping moves somebody's data to a time it did not happen, silently.
    const ahead = Instant.plus(AT, Duration.hours(2));
    const result = admitOne(anEvent({ occurredAt: Instant.toISO(ahead) }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        kind: "ClockSkew",
        skewMs: Duration.toMillis(Duration.hours(2)),
        max: Duration.toMillis(DEFAULT_ADMISSION_POLICY.maxFutureSkew),
      });
    }
  });

  test("a week of buffered offline events is not skew", () => {
    const old = Instant.minus(AT, Duration.days(7));
    expect(isOk(admitOne(anEvent({ occurredAt: Instant.toISO(old) })))).toBe(true);
  });

  test("something older than the retention horizon is refused, and the skew is signed", () => {
    const ancient = Instant.minus(AT, Duration.days(400));
    const result = admitOne(anEvent({ occurredAt: Instant.toISO(ancient) }));
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.kind === "ClockSkew") {
      expect(result.error.skewMs).toBeLessThan(0);
    } else {
      throw new Error("expected ClockSkew");
    }
  });

  test("every event in one batch is judged against one instant", () => {
    // Not `Date.now()` per event: the boundary cases would be nondeterministic
    // and a batch would admit or refuse differently on a slow machine.
    const edge = Instant.plus(AT, DEFAULT_ADMISSION_POLICY.maxFutureSkew);
    const events = Array.from({ length: 20 }, (_, i) =>
      anEvent({ occurredAt: Instant.toISO(edge), idempotencyKey: `k${i}` }),
    );
    const result = admit(batchOf(events));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.rejected).toEqual([]);
    expect(result.value.admitted).toHaveLength(20);
  });
});

describe("properties", () => {
  test("scalars pass through unchanged", () => {
    const result = admitOne(anEvent({ properties: { plan: "pro", seats: 3, trial: false, note: null } }));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.properties).toEqual({ plan: "pro", seats: 3, trial: false, note: null });
  });

  test("a nested object is refused, not stringified and not dropped", () => {
    // `"[object Object]"` looks like a value and is not; dropping loses a
    // field the developer believes they are sending. Both are silent.
    const result = admitOne(anEvent({ properties: { user: { id: 1 } } }));
    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.kind === "MalformedEvent") {
      expect(result.error.detail).toContain("user");
    } else {
      throw new Error("expected MalformedEvent");
    }
  });

  test("NaN is refused: it survives JSON as null and reads as a real number", () => {
    const result = admitOne(anEvent({ properties: { value: Number.NaN } }));
    expect(isErr(result)).toBe(true);
  });

  test("too many properties is refused", () => {
    const many = Object.fromEntries(
      Array.from({ length: DEFAULT_ADMISSION_POLICY.maxProperties + 1 }, (_, i) => [`p${i}`, i]),
    );
    expect(isErr(admitOne(anEvent({ properties: many })))).toBe(true);
  });
});

describe("system properties", () => {
  test("the operating system is collapsed and the raw spelling kept", () => {
    const result = admitOne(anEvent({ systemProperties: { os_name: "Mac OS X", os_version: "15.2" } }));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.system.os_name).toBe("macos");
    expect(result.value.system.os_name_raw).toBe("Mac OS X");
  });

  test("a broken systemProperties costs the event its dimensions, not its existence", () => {
    const result = admitOne(anEvent({ systemProperties: "not an object" }));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.system.os_name).toBe("other");
    expect(result.value.system.sdk_version).toBeNull();
  });
});

/**
 * `country` is the one thing on an event that is not the client's to say.
 *
 * The transport works it out from the request address, discards the address,
 * and puts two letters on the batch. Admission stamps that onto every event in
 * the batch — and, critically, ignores whatever the payload claims.
 */
describe("country comes from the batch, never from the payload", () => {
  const withCountry = (raw: RawEvent, country: CountryCode | null) => {
    const batch = batchOf([raw], { country });
    return admitEvent(raw, 0, batch, DEFAULT_ADMISSION_POLICY);
  };

  test("the batch's country is stamped on every event in it", () => {
    const batch = batchOf([anEvent({ idempotencyKey: "a" }), anEvent({ idempotencyKey: "b" })], {
      country: admitCountry("NZ"),
    });
    const outcome = admit(batch);
    if (!isOk(outcome)) throw new Error("expected Ok");
    expect(outcome.value.admitted).toHaveLength(2);
    for (const event of outcome.value.admitted) expect(event.system.country).toBe("NZ" as never);
  });

  test("a client that names its own country is ignored, not trusted and not refused", () => {
    // Refusing would cost the event; trusting would let anybody put their
    // traffic anywhere on the map. It is dropped like any other key that is not
    // one of the six the SDK may send.
    const result = withCountry(
      anEvent({ systemProperties: { os_name: "ios", country: "US" } }),
      admitCountry("NZ"),
    );
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.system.country).toBe("NZ" as never);
    expect(result.value.system.os_name).toBe("ios");
  });

  test("a client cannot smuggle anything into the field, including an address", () => {
    // The field the discard depends on. A client that could write a string here
    // could write the very thing we threw away.
    for (const claimed of ["203.0.113.7", "2001:db8::1", "us", { cc: "US" }, 12]) {
      const result = withCountry(anEvent({ systemProperties: { country: claimed } }), null);
      if (!isOk(result)) throw new Error("expected Ok");
      expect(result.value.system.country).toBeNull();
    }
  });

  test("a batch with no country stamps null, which is a real answer", () => {
    // A private range, an unreadable header, address space no registry has
    // delegated. Null means "we could not tell" and is absent from a breakdown
    // rather than a bucket a reader would take for a place.
    const result = withCountry(anEvent(), null);
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.system.country).toBeNull();
  });

  test("country never becomes an ordinary property either", () => {
    const result = withCountry(
      anEvent({ properties: { country: "US" }, systemProperties: {} }),
      admitCountry("NZ"),
    );
    if (!isOk(result)) throw new Error("expected Ok");
    // A customer property genuinely named `country` is theirs and is kept —
    // `FieldRef` keeps the two namespaces apart, so it does not collide with
    // the dimension.
    expect(result.value.properties["country"]).toBe("US");
    expect(result.value.system.country).toBe("NZ" as never);
  });
});

describe("a person only ever arrives from identify()", () => {
  test("no userId means no person, whatever the visit id looks like", () => {
    // The v1 bug: "unique users" was a count of distinct session ids, and a
    // session id rolled over every thirty idle minutes. A visit that happens
    // to look durable still does not become an identity.
    for (const visitId of ["1770000000.abcd1234", "cus_9f2", "durable-looking-id"]) {
      const result = admitOne(anEvent({ visitId, userId: undefined }));
      if (!isOk(result)) throw new Error("expected Ok");
      expect(result.value.visit).toBe(visitId as never);
      expect(result.value.person).toBeNull();
    }
  });

  test("an explicit userId becomes the person", () => {
    const result = admitOne(anEvent({ userId: "cus_9f2" }));
    if (!isOk(result)) throw new Error("expected Ok");
    expect(result.value.person).toBe("cus_9f2" as never);
  });

  test("an email address is refused, whatever else is true of the event", () => {
    const result = admitOne(anEvent({ userId: "ada@example.com" }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error).toEqual({ kind: "PersonIdLooksLikeEmail" });
  });
});
