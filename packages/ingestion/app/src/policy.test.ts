import { describe, expect, test } from "bun:test";

import { Duration, Instant } from "@counted/kernel";

import {
  DEFAULT_GROUP_COMMIT_POLICY,
  deadline,
  decide,
  receive,
  type CommitState,
  type GroupCommitPolicy,
  type PendingGroup,
} from "./policy";

const T0 = Instant.fromEpochMillis(1_770_000_000_000);

const POLICY: GroupCommitPolicy = {
  linger: Duration.millis(20),
  maxEvents: 100,
  maxWaiters: 8,
  maxBuffered: 1_000,
  maxInFlight: 2,
  retryAfter: Duration.seconds(1),
};

const group = (overrides: Partial<PendingGroup> = {}): PendingGroup => ({
  events: 1,
  waiters: 1,
  openedAt: T0,
  ...overrides,
});

const state = (overrides: Partial<CommitState> = {}): CommitState => ({
  group: group(),
  inFlight: 0,
  draining: false,
  ...overrides,
});

describe("decide", () => {
  test("nothing pending is idle, not a flush of zero events", () => {
    expect(decide(state({ group: null }), POLICY, T0)).toEqual({ kind: "Idle" });
  });

  test("a young, small group waits until its deadline", () => {
    const decision = decide(state(), POLICY, Instant.plus(T0, Duration.millis(5)));
    expect(decision).toEqual({ kind: "Wait", until: Instant.plus(T0, Duration.millis(20)) });
  });

  test("the linger runs from the oldest event, so a steady trickle cannot starve the first one", () => {
    // Measured from the newest arrival, every new event pushes the deadline
    // out and the first event in the group waits forever. This is the bug the
    // whole `openedAt` field exists for.
    const trickled = group({ events: 12, openedAt: T0 });
    const now = Instant.plus(T0, Duration.millis(25));
    expect(decide(state({ group: trickled }), POLICY, now)).toEqual({ kind: "Flush", reason: "Linger" });
  });

  test("a full group flushes before its deadline", () => {
    const full = group({ events: POLICY.maxEvents });
    expect(decide(state({ group: full }), POLICY, T0)).toEqual({ kind: "Flush", reason: "Size" });
  });

  test("many small requests flush on waiter count, not on event count", () => {
    // Sixty-four clients each sending one event is a group of sixty-four
    // promises. Waiting for `maxEvents` would hold all of them for the full
    // linger and then some.
    const crowded = group({ events: 8, waiters: POLICY.maxWaiters });
    expect(decide(state({ group: crowded }), POLICY, T0)).toEqual({ kind: "Flush", reason: "Waiters" });
  });

  test("exactly at the deadline flushes rather than waiting one more millisecond", () => {
    const at = deadline(group(), POLICY);
    expect(decide(state(), POLICY, at)).toEqual({ kind: "Flush", reason: "Linger" });
  });

  test("a ready group is blocked, not flushed, once the concurrency ceiling is reached", () => {
    // Without this a slow sink turns every arrival into another open
    // connection and the buffer ceiling stops meaning anything.
    const full = group({ events: POLICY.maxEvents });
    expect(decide(state({ group: full, inFlight: POLICY.maxInFlight }), POLICY, T0)).toEqual({ kind: "Blocked" });
  });

  test("draining flushes whatever is there, deadline or not", () => {
    expect(decide(state({ draining: true }), POLICY, T0)).toEqual({ kind: "Flush", reason: "Drain" });
  });

  test("draining still respects the concurrency ceiling", () => {
    expect(decide(state({ draining: true, inFlight: POLICY.maxInFlight }), POLICY, T0)).toEqual({ kind: "Blocked" });
  });

  test("a pending group is never idle — something always has to happen to it", () => {
    const nows = [T0, Instant.plus(T0, Duration.millis(19)), Instant.plus(T0, Duration.millis(20)), Instant.plus(T0, Duration.hours(1))];
    for (const now of nows) {
      for (const inFlight of [0, POLICY.maxInFlight]) {
        expect(decide(state({ inFlight }), POLICY, now).kind).not.toBe("Idle");
      }
    }
  });
});

describe("receive", () => {
  test("there is room until there is not", () => {
    expect(receive(0, 500, POLICY)).toEqual({ kind: "Accept" });
    expect(receive(999, 1, POLICY)).toEqual({ kind: "Accept" });
  });

  test("one event past the ceiling is refused, with something to tell the client", () => {
    // Refused, never dropped. A 202 that means "discarded" is the v1 bug this
    // whole module exists to make impossible.
    expect(receive(1_000, 1, POLICY)).toEqual({ kind: "Refuse", retryAfter: POLICY.retryAfter });
  });

  test("a single request larger than the whole ceiling is refused rather than special-cased", () => {
    expect(receive(0, POLICY.maxBuffered + 1, POLICY).kind).toBe("Refuse");
  });

  test("the ceiling is checked against what is arriving, not just against what is held", () => {
    // Checking `buffered > max` alone lets one request of any size through.
    expect(receive(999, 500, POLICY).kind).toBe("Refuse");
  });
});

describe("the shipped defaults", () => {
  test("linger is short enough that a synchronous flush() is not perceptible", () => {
    expect(Duration.toMillis(DEFAULT_GROUP_COMMIT_POLICY.linger)).toBeLessThanOrEqual(50);
  });

  test("the buffer ceiling is finite, which is the whole point of having one", () => {
    expect(Number.isFinite(DEFAULT_GROUP_COMMIT_POLICY.maxBuffered)).toBe(true);
    expect(DEFAULT_GROUP_COMMIT_POLICY.maxBuffered).toBeGreaterThan(DEFAULT_GROUP_COMMIT_POLICY.maxEvents);
  });
});
