/**
 * `outbox.dispatch`, over stubs.
 *
 * The claims being tested are the delivery guarantees, and they are narrower
 * than "exactly once": a row is claimed once, delivered at least once, and
 * carries a stable id so a receiver can drop a duplicate. Anything stronger
 * would be untrue, and untrue comments are what this rewrite exists to remove.
 */

import { describe, expect, test } from "bun:test";
import { Instant } from "@counted/domain";
import type { DomainEventEnvelope, Notification, UnitOfWork } from "@counted/ports";
import { MAX_DELIVERY_ATTEMPTS, outboxDispatch } from "./outbox-dispatch";

const now = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const job = { id: "j", name: "outbox.dispatch" as const, key: "k", payload: {}, runAfter: now, attempts: 1 };

const logged: { level: string; event: string; fields?: Record<string, unknown> | undefined }[] = [];
const log = {
  info: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "info", event, fields }),
  warn: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "warn", event, fields }),
  error: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "error", event, fields }),
};
const context = { now, log, leaseMs: 60_000 };

const fired = (id: string): DomainEventEnvelope => ({
  id,
  type: "MonitorFired",
  occurredAt: now,
  payload: { monitor: "m1", observed: 500, threshold: { comparison: "above", value: 100 }, entering: true },
});

const world = (events: readonly DomainEventEnvelope[], attemptsSoFar = 0) => {
  const dispatched: string[] = [];
  const failures: { id: string; error: string }[] = [];
  let attempts = attemptsSoFar;

  const unitOfWork = {
    transact: async (work: (repos: unknown) => Promise<unknown>) =>
      work({
        outbox: {
          claim: async (limit: number) => events.slice(0, limit),
          markDispatched: async (ids: readonly string[]) => void dispatched.push(...ids),
          recordFailure: async (id: string, error: string) => {
            failures.push({ id, error });
            attempts += 1;
            return attempts;
          },
        },
      }),
  } as unknown as UnitOfWork;

  return { unitOfWork, dispatched, failures };
};

const notifier = (behaviour: (n: Notification) => void | Promise<void> = () => {}) => {
  const sent: Notification[] = [];
  return {
    sent,
    notifier: {
      deliver: async (notification: Notification) => {
        await behaviour(notification);
        sent.push(notification);
      },
    },
  };
};

const emailChannel = async () => [{ kind: "email" as const, address: "ops@example.com" }];
const noChannels = async () => [];

describe("delivering", () => {
  test("a fired monitor becomes a notification", async () => {
    const { unitOfWork, dispatched } = world([fired("evt_1")]);
    const { notifier: n, sent } = notifier();

    const outcome = await outboxDispatch({ unitOfWork, notifier: n, channelsFor: emailChannel })(job, context);

    expect(sent).toHaveLength(1);
    expect(dispatched).toEqual(["evt_1"]);
    expect(outcome.kind).toBe("done");
  });

  test("an empty outbox is a noop, and nothing is sent", async () => {
    const { unitOfWork } = world([]);
    const { notifier: n, sent } = notifier();
    expect((await outboxDispatch({ unitOfWork, notifier: n, channelsFor: emailChannel })(job, context)).kind).toBe(
      "noop",
    );
    expect(sent).toEqual([]);
  });

  test("an event nobody subscribes to is marked, not left behind", async () => {
    // Otherwise it sits at the head of the queue forever and everything
    // behind it is claimed after it, run after run.
    const { unitOfWork, dispatched } = world([fired("evt_1")]);
    const { notifier: n, sent } = notifier();

    await outboxDispatch({ unitOfWork, notifier: n, channelsFor: noChannels })(job, context);
    expect(sent).toEqual([]);
    expect(dispatched).toEqual(["evt_1"]);
  });

  test("an event type that notifies nobody is still drained", async () => {
    const created: DomainEventEnvelope = { id: "evt_x", type: "MonitorCreated", occurredAt: now, payload: {} };
    const { unitOfWork, dispatched } = world([created]);
    const { notifier: n, sent } = notifier();

    await outboxDispatch({ unitOfWork, notifier: n, channelsFor: emailChannel })(job, context);
    expect(sent).toEqual([]);
    expect(dispatched).toEqual(["evt_x"]);
  });

  test("channels are resolved once per event, not once per notification", async () => {
    let lookups = 0;
    const { unitOfWork } = world([fired("evt_1")]);
    const { notifier: n } = notifier();

    await outboxDispatch({
      unitOfWork,
      notifier: n,
      channelsFor: async () => {
        lookups += 1;
        return [
          { kind: "email" as const, address: "a@example.com" },
          { kind: "email" as const, address: "b@example.com" },
          { kind: "webhook" as const, url: "https://x.example.com/h" },
        ];
      },
    })(job, context);

    expect(lookups).toBe(1);
  });
});

describe("a failed delivery is retried, not lost", () => {
  test("the event is not marked dispatched", async () => {
    const { unitOfWork, dispatched, failures } = world([fired("evt_1")]);
    const { notifier: n } = notifier(() => {
      throw new Error("connection reset");
    });

    await outboxDispatch({ unitOfWork, notifier: n, channelsFor: emailChannel })(job, context);

    expect(dispatched).toEqual([]);
    expect(failures).toEqual([{ id: "evt_1", error: "connection reset" }]);
  });

  test("one failing event does not stop the others", async () => {
    let n = 0;
    const { unitOfWork, dispatched } = world([fired("evt_1"), fired("evt_2"), fired("evt_3")]);
    const { notifier: notify } = notifier(() => {
      if (n++ === 1) throw new Error("timeout");
    });

    await outboxDispatch({ unitOfWork, notifier: notify, channelsFor: emailChannel })(job, context);
    expect(dispatched).toEqual(["evt_1", "evt_3"]);
  });

  test("the failure is reported while it is still being retried", async () => {
    logged.length = 0;
    const { unitOfWork } = world([fired("evt_1")]);
    const { notifier: n } = notifier(() => {
      throw new Error("nope");
    });

    await outboxDispatch({ unitOfWork, notifier: n, channelsFor: emailChannel })(job, context);
    const line = logged.find((l) => l.event === "outbox.delivery_failed");
    expect(line?.level).toBe("warn");
  });

  test("past the attempt limit it is given up on, loudly, and drained", async () => {
    // An endpoint dead for a day will not come back because we asked a
    // thousandth time, and a queue that never drains hides everything behind
    // it.
    logged.length = 0;
    const { unitOfWork, dispatched } = world([fired("evt_1")], MAX_DELIVERY_ATTEMPTS - 1);
    const { notifier: n } = notifier(() => {
      throw new Error("gone");
    });

    await outboxDispatch({ unitOfWork, notifier: n, channelsFor: emailChannel })(job, context);

    expect(dispatched).toEqual(["evt_1"]);
    expect(logged.find((l) => l.event === "outbox.abandoned")?.level).toBe("error");
  });
});

describe("what a receiver gets", () => {
  test("a webhook carries the outbox row's id, stable across redeliveries", async () => {
    // Delivery is at-least-once. This is what makes a duplicate survivable
    // rather than a second alert.
    const { unitOfWork } = world([fired("evt_stable")]);
    const { notifier: n, sent } = notifier();

    await outboxDispatch({
      unitOfWork,
      notifier: n,
      channelsFor: async () => [{ kind: "webhook" as const, url: "https://x.example.com/h" }],
    })(job, context);

    const delivered = sent[0]!;
    expect(delivered.channel).toBe("webhook");
    if (delivered.channel === "webhook") {
      expect(delivered.id).toBe("evt_stable");
      expect(delivered.payload).toMatchObject({ id: "evt_stable", type: "MonitorFired" });
    }
  });

  test("redelivering the same event sends the same id", async () => {
    const { notifier: n, sent } = notifier();
    const dispatch = outboxDispatch({
      unitOfWork: world([fired("evt_1")]).unitOfWork,
      notifier: n,
      channelsFor: async () => [{ kind: "webhook" as const, url: "https://x.example.com/h" }],
    });

    await dispatch(job, context);
    await dispatch(job, context);

    expect(sent).toHaveLength(2);
    const ids = sent.map((s) => (s.channel === "webhook" ? s.id : null));
    expect(ids[0]).toBe(ids[1]);
  });

  test("an email says what happened without needing the payload", async () => {
    const { unitOfWork } = world([fired("evt_1")]);
    const { notifier: n, sent } = notifier();

    await outboxDispatch({ unitOfWork, notifier: n, channelsFor: emailChannel })(job, context);
    const delivered = sent[0]!;
    if (delivered.channel === "email") {
      expect(delivered.subject).toContain("breaching");
      expect(delivered.body).toContain("500");
      expect(delivered.body).toContain("above 100");
    }
  });
});
