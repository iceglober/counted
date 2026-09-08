import { describe, expect, test } from "bun:test";

import { Duration, Instant, ProjectId, WorkspaceId, err, ok } from "@counted/kernel";
import { scriptedClock } from "@counted/kernel/ports";
import type { AdmittedEvent, IngestBatch, RawEvent } from "@counted/ingestion-domain";

import { GroupCommit, type Ack, type CommitProblem } from "./group-commit";
import { DEFAULT_GROUP_COMMIT_POLICY, type GroupCommitPolicy } from "./policy";
import type { EventSink, IngestQuota, QuotaVerdict, WriteFailure, WriteReceipt } from "./ports";

const T0 = Instant.fromEpochMillis(Date.UTC(2026, 7, 30, 12, 0, 0));

const POLICY: GroupCommitPolicy = {
  ...DEFAULT_GROUP_COMMIT_POLICY,
  linger: Duration.millis(20),
  maxEvents: 10,
  maxWaiters: 4,
  maxBuffered: 40,
  maxInFlight: 2,
  retryAfter: Duration.seconds(1),
};

/** A sink whose every write is held open until the test lets it finish. */
const controllableSink = () => {
  type Call = {
    readonly project: ProjectId;
    readonly events: readonly AdmittedEvent[];
    readonly finish: (result: Awaited<ReturnType<EventSink["writeBatch"]>>) => void;
  };
  const calls: Call[] = [];
  let autoComplete = true;

  const sink: EventSink = {
    writeBatch: (project, events) =>
      new Promise((resolve) => {
        const call: Call = { project, events, finish: resolve };
        calls.push(call);
        if (autoComplete) {
          resolve(ok<WriteReceipt>({ written: events.length, writtenIndices: events.map((_, index) => index), deduplicated: 0 }));
        }
      }),
  };

  return {
    sink,
    calls,
    hold: () => {
      autoComplete = false;
    },
    release: (index: number, receipt?: WriteReceipt) => {
      const call = calls[index];
      if (call === undefined) throw new Error(`no call at ${index}`);
      call.finish(ok(receipt ?? { written: call.events.length, writtenIndices: call.events.map((_, index) => index), deduplicated: 0 }));
    },
    fail: (index: number, failure: WriteFailure) => {
      const call = calls[index];
      if (call === undefined) throw new Error(`no call at ${index}`);
      call.finish(err(failure));
    },
  };
};

const allowingQuota = (verdict: QuotaVerdict = { kind: "Allowed", remaining: null }) => {
  const recorded: { workspace: WorkspaceId; count: number }[] = [];
  const quota: IngestQuota = {
    check: () => Promise.resolve(verdict),
    record: (workspace, count) => {
      recorded.push({ workspace, count });
      return Promise.resolve();
    },
  };
  return { quota, recorded };
};

const rawEvent = (key: string): RawEvent => ({
  name: "checkout_completed",
  visitId: "1770000000.abcd1234",
  occurredAt: Instant.toISO(T0),
  idempotencyKey: key,
});

const batch = (events: readonly RawEvent[], project = "prj_1", receivedAt: Instant = T0): IngestBatch => ({
  workspace: WorkspaceId("ws_1"),
  project: ProjectId(project),
  receivedAt,
  events,
  country: null,
  bytes: null,
});

/** Let queued microtasks run without advancing the clock. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

type Overrides = {
  readonly sink?: EventSink;
  readonly quota?: IngestQuota;
  readonly policy?: GroupCommitPolicy;
};

const build = (overrides: Overrides = {}) => {
  const clock = scriptedClock(T0);
  const { sink, ...control } = controllableSink();
  const { quota, recorded } = allowingQuota();
  const problems: CommitProblem[] = [];
  const coalescer = new GroupCommit({
    sink: overrides.sink ?? sink,
    quota: overrides.quota ?? quota,
    clock,
    policy: overrides.policy ?? POLICY,
    onProblem: (problem) => problems.push(problem),
  });
  return { coalescer, clock, sink, recorded, problems, ...control };
};

describe("nothing is acknowledged before it is durable", () => {
  test("the ack does not resolve while the write is outstanding", async () => {
    const { coalescer, clock, hold, calls, release } = build();
    hold();

    let settled: Ack | null = null;
    const ack = coalescer.submit(batch([rawEvent("k1")])).then((value) => (settled = value));
    await settle();

    clock.advance(Duration.millis(25));
    coalescer.tick();
    await settle();

    // The commit has started — and the client has still been told nothing.
    expect(calls).toHaveLength(1);
    expect(settled).toBeNull();

    release(0);
    await ack;
    expect(settled).not.toBeNull();
  });

  test("a request that joins an in-flight-free group waits for that group's commit", async () => {
    const { coalescer, clock, hold, release } = build();
    hold();

    const first = coalescer.submit(batch([rawEvent("k1")]));
    const second = coalescer.submit(batch([rawEvent("k2")]));
    await settle();

    clock.advance(Duration.millis(25));
    coalescer.tick();
    await settle();

    release(0);
    const [a, b] = await Promise.all([first, second]);
    expect(a.kind).toBe("Committed");
    expect(b.kind).toBe("Committed");
  });
});

describe("many requests, one commit", () => {
  test("requests that arrive together ride one write", async () => {
    const { coalescer, clock, calls } = build();

    const acks = [rawEvent("k1"), rawEvent("k2"), rawEvent("k3")].map((event) => coalescer.submit(batch([event])));
    await settle();

    clock.advance(Duration.millis(25));
    coalescer.tick();
    await Promise.all(acks);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.events).toHaveLength(3);
  });

  test("each request is told about its own events, and about the group it rode", async () => {
    const { coalescer, clock } = build();

    const mine = coalescer.submit(batch([rawEvent("k1"), rawEvent("k2")]));
    const theirs = coalescer.submit(batch([rawEvent("k3")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();

    const ack = await mine;
    await theirs;
    if (ack.kind !== "Committed") throw new Error("expected Committed");
    expect(ack.accepted).toBe(2);
    // The group number is labelled as the group's, so nobody reads three
    // events as "mine".
    expect(ack.commit).toEqual({ size: 3, written: 3, deduplicated: 0 });
  });

  test("two projects never share a commit", async () => {
    const { coalescer, clock, calls } = build();

    const a = coalescer.submit(batch([rawEvent("k1")], "prj_1"));
    const b = coalescer.submit(batch([rawEvent("k2")], "prj_2"));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();
    await Promise.all([a, b]);

    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.project))).toEqual(new Set([ProjectId("prj_1"), ProjectId("prj_2")]));
  });

  test("a full group commits without waiting for the linger", async () => {
    const { coalescer, calls } = build();
    const events = Array.from({ length: POLICY.maxEvents }, (_, i) => rawEvent(`k${i}`));

    const ack = coalescer.submit(batch(events));
    await settle();

    // No clock advance, no tick: the size threshold did it.
    expect(calls).toHaveLength(1);
    await ack;
  });
});

describe("the buffer is bounded, and a refusal says so", () => {
  test("past the ceiling an arrival is refused rather than buffered", async () => {
    // A ceiling of three events and nothing that would flush them, so the
    // buffer genuinely fills — which is what happens when the sink is down.
    const { coalescer } = build({ policy: { ...POLICY, maxEvents: 1_000, maxWaiters: 1_000, maxBuffered: 3 } });

    const held = coalescer.submit(batch([rawEvent("h1"), rawEvent("h2"), rawEvent("h3")]));
    await settle();
    expect(coalescer.buffered).toBe(3);

    const refused = await coalescer.submit(batch([rawEvent("overflow")]));
    if (refused.kind !== "Refused") throw new Error("expected Refused");
    // 429 with something to wait for — not a 202 that means "discarded".
    expect(refused.error).toEqual({ kind: "RateLimited", retryAfterMs: 1_000 });
    // And the refusal cost the buffer nothing: nothing was dropped to make room.
    expect(coalescer.buffered).toBe(3);

    await coalescer.drain();
    expect((await held).kind).toBe("Committed");
  });

  test("the buffer empties as commits land, and arrivals are accepted again", async () => {
    const { coalescer, clock, release, calls } = build();

    const first = coalescer.submit(batch(Array.from({ length: 10 }, (_, i) => rawEvent(`a${i}`))));
    await settle();
    expect(coalescer.buffered).toBe(0); // already flushed on size
    expect(calls).toHaveLength(1);
    await first;

    clock.advance(Duration.millis(1));
    const second = coalescer.submit(batch([rawEvent("b1")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();
    await settle();
    expect((await second).kind).toBe("Committed");
    void release;
  });
});

describe("the quota refuses before anything is buffered", () => {
  test("an exhausted plan is 402-shaped and names the numbers", async () => {
    const quota: IngestQuota = {
      check: () => Promise.resolve<QuotaVerdict>({ kind: "PlanExceeded", limit: 1_000_000, used: 1_000_001 }),
      record: () => Promise.resolve(),
    };
    const { coalescer, calls } = build({ quota });

    const ack = await coalescer.submit(batch([rawEvent("k1")]));
    expect(ack).toEqual({
      kind: "Refused",
      error: { kind: "PlanExceeded", limit: 1_000_000, used: 1_000_001 },
      rejected: [],
    });
    expect(calls).toHaveLength(0);
  });

  test("rate limiting is a different answer from an exhausted plan", async () => {
    // Upgrade versus back off. v1 answered both with 429 and the support
    // thread that produced was somebody retrying for two days.
    const quota: IngestQuota = {
      check: () => Promise.resolve<QuotaVerdict>({ kind: "RateLimited", retryAfter: Duration.seconds(30) }),
      record: () => Promise.resolve(),
    };
    const { coalescer } = build({ quota });

    const ack = await coalescer.submit(batch([rawEvent("k1")]));
    if (ack.kind !== "Refused") throw new Error("expected Refused");
    expect(ack.error).toEqual({ kind: "RateLimited", retryAfterMs: 30_000 });
  });

  test("usage is recorded after the write, so a failed commit costs the customer nothing", async () => {
    const { coalescer, clock, recorded, fail, hold } = build();
    hold();

    const ack = coalescer.submit(batch([rawEvent("k1")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();
    await settle();

    fail(0, { kind: "SinkUnavailable", detail: "connection refused" });
    await ack;
    expect(recorded).toEqual([]);
  });
});

describe("a failed commit is reported as a failure", () => {
  test("every waiter in the group is told, and told to retry", async () => {
    const { coalescer, clock, hold, fail } = build();
    hold();

    const acks = [rawEvent("k1"), rawEvent("k2")].map((event) => coalescer.submit(batch([event])));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();
    await settle();

    fail(0, { kind: "Timeout" });
    for (const ack of await Promise.all(acks)) {
      expect(ack.kind).toBe("Refused");
      if (ack.kind !== "Refused") continue;
      // 503: nothing was written and the client still holds the events.
      expect(ack.error.kind).toBe("SinkUnavailable");
    }
  });

  test("a sink that throws leaves nobody waiting forever", async () => {
    const sink: EventSink = { writeBatch: () => Promise.reject(new Error("pool exhausted")) };
    const { coalescer, clock, problems } = build({ sink });

    const ack = coalescer.submit(batch([rawEvent("k1")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();

    const settled = await ack;
    expect(settled.kind).toBe("Refused");
    expect(problems.map((p) => p.kind)).toEqual(["SinkThrew"]);
  });

  test("a quota that throws does not turn a durable write into a failure", async () => {
    const quota: IngestQuota = {
      check: () => Promise.resolve<QuotaVerdict>({ kind: "Allowed", remaining: null }),
      record: () => Promise.reject(new Error("usage table locked")),
    };
    const { coalescer, clock, problems } = build({ quota });

    const ack = coalescer.submit(batch([rawEvent("k1")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();

    // Telling the client to resend data we already hold would be worse than
    // an unincremented counter.
    expect((await ack).kind).toBe("Committed");
    expect(problems.map((p) => p.kind)).toEqual(["QuotaNotRecorded"]);
  });
});

describe("deduplication across requests in one group", () => {
  test("a retried request rides the same group and is not written twice", async () => {
    const { coalescer, clock, calls } = build();

    const first = coalescer.submit(batch([rawEvent("k1")]));
    const retry = coalescer.submit(batch([rawEvent("k1")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();

    const [a, b] = await Promise.all([first, retry]);
    expect(calls[0]?.events).toHaveLength(1);
    if (a.kind !== "Committed" || b.kind !== "Committed") throw new Error("expected Committed");
    expect(a.accepted).toBe(1);
    expect(b.accepted).toBe(0);
    expect(b.deduplicated).toBe(1);
  });

  test("the retry is not acknowledged before the group it deduplicated into commits", async () => {
    // Acknowledging it early would say "we have these" while the only copies
    // are still in memory — and if the commit then failed, the retry would
    // have been told success while the original was told failure.
    const { coalescer, clock, hold, fail } = build();
    hold();

    const first = coalescer.submit(batch([rawEvent("k1")]));
    const retry = coalescer.submit(batch([rawEvent("k1")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();
    await settle();

    fail(0, { kind: "SinkUnavailable", detail: "down" });
    const [a, b] = await Promise.all([first, retry]);
    expect(a.kind).toBe("Refused");
    expect(b.kind).toBe("Refused");
  });
});

describe("admission failures never reach the sink", () => {
  test("a batch too large is refused whole", async () => {
    const { coalescer, calls } = build();
    const events = Array.from({ length: 400 }, (_, i) => rawEvent(`k${i}`));

    const ack = await coalescer.submit(batch(events));
    if (ack.kind !== "Refused") throw new Error("expected Refused");
    expect(ack.error.kind).toBe("BatchTooLarge");
    expect(calls).toHaveLength(0);
  });

  test("a batch where every event is malformed settles at once rather than waiting for a commit", async () => {
    const { coalescer, calls } = build();

    const ack = await coalescer.submit(batch([{ name: "" }, { name: "" }]));
    if (ack.kind !== "Committed") throw new Error("expected Committed");
    expect(ack.accepted).toBe(0);
    expect(ack.commit).toBeNull();
    expect(ack.rejected).toHaveLength(2);
    expect(calls).toHaveLength(0);
  });

  test("the good events commit and the bad ones come back named", async () => {
    const { coalescer, clock } = build();

    const ack = coalescer.submit(batch([rawEvent("k1"), { name: 7 } as RawEvent, rawEvent("k3")]));
    await settle();
    clock.advance(Duration.millis(25));
    coalescer.tick();

    const settled = await ack;
    if (settled.kind !== "Committed") throw new Error("expected Committed");
    expect(settled.accepted).toBe(2);
    expect(settled.rejected.map((r) => r.index)).toEqual([1]);
  });
});

describe("deadlines and shutdown", () => {
  test("there is no deadline when nothing is pending", () => {
    const { coalescer } = build();
    expect(coalescer.nextDeadlineAt()).toBeNull();
  });

  test("the deadline is the earliest across projects, so one timer serves the process", async () => {
    const { coalescer, clock } = build();

    void coalescer.submit(batch([rawEvent("k1")], "prj_1"));
    await settle();
    clock.advance(Duration.millis(5));
    void coalescer.submit(batch([rawEvent("k2")], "prj_2"));
    await settle();

    expect(coalescer.nextDeadlineAt()).toEqual(Instant.plus(T0, POLICY.linger));
  });

  test("drain settles every waiter before it resolves", async () => {
    const { coalescer } = build();

    const acks = [rawEvent("k1"), rawEvent("k2")].map((event) => coalescer.submit(batch([event])));
    await settle();
    expect(coalescer.waiting).toBe(2);

    // No clock advance: draining does not wait for a deadline.
    await coalescer.drain();

    // A process that exits with waiters outstanding has accepted events and
    // answered nobody.
    for (const ack of await Promise.all(acks)) expect(ack.kind).toBe("Committed");
    expect(coalescer.waiting).toBe(0);
    expect(coalescer.buffered).toBe(0);
  });

  test("an arrival during shutdown is refused, not buffered into a group nobody will flush", async () => {
    const { coalescer } = build();
    await coalescer.drain();

    const ack = await coalescer.submit(batch([rawEvent("k1")]));
    if (ack.kind !== "Refused") throw new Error("expected Refused");
    expect(ack.error.kind).toBe("SinkUnavailable");
  });
});


describe("durable deduplication receipts", () => {
  test("attributes stored repeats to each request in a shared group", async () => {
    const {coalescer, hold, release, clock, recorded} = build();
    hold();
    const first = coalescer.submit(batch([rawEvent("a"), rawEvent("b"), rawEvent("a")]));
    const second = coalescer.submit(batch([rawEvent("b"), rawEvent("c"), rawEvent("d")]));
    await settle();
    clock.advance(Duration.millis(20)); coalescer.tick();
    release(0, {written:2, writtenIndices:[1,2], deduplicated:2});
    expect(await first).toMatchObject({kind:"Committed", accepted:1, deduplicated:2});
    expect(await second).toMatchObject({kind:"Committed", accepted:1, deduplicated:2});
    expect(recorded).toEqual([{workspace:WorkspaceId("ws_1"),count:2}]);
  });

  test("invalid sink indices produce a retryable failure instead of an invented receipt", async () => {
    const {coalescer, hold, release, clock, problems} = build();
    hold();
    const reply = coalescer.submit(batch([rawEvent("a")]));
    await settle(); clock.advance(Duration.millis(20)); coalescer.tick();
    release(0, {written:1,writtenIndices:[2],deduplicated:0});
    expect(await reply).toMatchObject({kind:"Refused",error:{kind:"SinkUnavailable"}});
    expect(problems[0]).toMatchObject({kind:"SinkThrew"});
  });
});
