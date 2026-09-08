import { describe, expect, test } from "bun:test";

import { Threshold, type Channel } from "@counted/dashboarding-domain";
import type { Analysis } from "@counted/analytics-domain";
import { Duration, Instant } from "@counted/kernel";
import type { Notification, Notifier } from "@counted/kernel/ports";

import { deliverMonitorAlerts, notificationsFor, sweepMonitors, type MonitorSweepDeps } from "./monitors";
import { recordingLogger } from "../logging";
import type { Observation, ScalarObserver } from "../observe";
import { aMonitor, countingIds, FakeMonitors, movableClock, T0 } from "../testing";

const EMAIL: Channel = { kind: "email", address: "ops@example.com" };
const HOOK: Channel = { kind: "webhook", url: "https://example.com/hook" };

const recordingNotifier = (): Notifier & { sent: Notification[] } => {
  const sent: Notification[] = [];
  return { sent, deliver: async (n) => void sent.push(n) };
};

const fixedObserver = (observation: Observation): ScalarObserver<Analysis> =>
  async () => observation;

const depsFor = (
  monitors: FakeMonitors,
  observe: ScalarObserver<Analysis>,
  notifier: Notifier = recordingNotifier(),
): MonitorSweepDeps<Analysis> & { logger: ReturnType<typeof recordingLogger> } => {
  const logger = recordingLogger();
  return {
    logger,
    monitors: { monitors, clock: movableClock(), ids: countingIds(), isScalar: (a) => ({ ok: true, value: a }) },
    observe,
    notifier,
    batch: 50,
  };
};

describe("the monitor sweep", () => {
  test("an observed breach fires, persists, and announces on every channel", async () => {
    const monitor = aMonitor({ threshold: Threshold.above(10), channels: [EMAIL, HOOK] });
    const repo = new FakeMonitors([monitor]);
    const notifier = recordingNotifier();
    const deps = depsFor(repo, fixedObserver({ kind: "observed", value: 42, computedAt: T0 }), notifier);

    const report = await sweepMonitors(deps, T0);

    expect(report).toMatchObject({ considered: 1, evaluated: 1, fired: 1, notified: 2 });
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]?.monitor.state).toBe("breaching");
    expect(notifier.sent.map((n) => n.channel)).toEqual(["email", "webhook"]);
  });

  /**
   * The one that matters. `Threshold.below(100)` is breached by zero, so a
   * failed query read as a number fires every low-traffic alert in the account
   * at once. Nothing is evaluated, nothing is saved, nothing is sent.
   */
  test("a monitor whose query failed is not evaluated at all", async () => {
    const monitor = aMonitor({ threshold: Threshold.below(100), channels: [EMAIL] });
    const repo = new FakeMonitors([monitor]);
    const notifier = recordingNotifier();
    const deps = depsFor(
      repo,
      fixedObserver({ kind: "unobservable", detail: "the engine timed out", retriable: true }),
      notifier,
    );

    const report = await sweepMonitors(deps, T0);

    expect(report).toMatchObject({ considered: 1, evaluated: 0, fired: 0, unobservable: 1 });
    expect(repo.saved).toHaveLength(1);
    expect(notifier.sent).toHaveLength(0);
  });

  test("a retriable failure warns and a permanent one errors", async () => {
    const repo = new FakeMonitors([aMonitor({ threshold: Threshold.above(1) })]);

    const transient = depsFor(repo, fixedObserver({ kind: "unobservable", detail: "busy", retriable: true }));
    await sweepMonitors(transient, T0);
    expect(transient.logger.lines[0]?.level).toBe("warn");

    const permanent = depsFor(repo, fixedObserver({ kind: "unobservable", detail: "bad", retriable: false }));
    await sweepMonitors(permanent, T0);
    expect(permanent.logger.lines[0]?.level).toBe("error");
  });

  test("no data is neither a breach nor a failure", async () => {
    const repo = new FakeMonitors([aMonitor({ threshold: Threshold.below(1) })]);
    const deps = depsFor(repo, fixedObserver({ kind: "no-data" }));

    const report = await sweepMonitors(deps, T0);

    expect(report).toMatchObject({ evaluated: 0, unobservable: 0, fired: 0 });
    expect(repo.saved).toHaveLength(1);
  });

  test("the state is saved before the notification is sent", async () => {
    const monitor = aMonitor({ threshold: Threshold.above(1), channels: [EMAIL] });
    const order: string[] = [];
    const repo = new FakeMonitors([monitor], () => order.push("save"));
    const notifier: Notifier = {
      deliver: async () => void order.push("notify"),
    };

    await sweepMonitors(depsFor(repo, fixedObserver({ kind: "observed", value: 9, computedAt: T0 }), notifier), T0);

    expect(order).toEqual(["save", "notify"]);
  });

  test("a delivery failure is reported and the sweep carries on", async () => {
    const repo = new FakeMonitors([
      aMonitor({ id: "mon_1", threshold: Threshold.above(1), channels: [EMAIL] }),
      aMonitor({ id: "mon_2", threshold: Threshold.above(1), channels: [EMAIL] }),
    ]);
    const notifier: Notifier = {
      deliver: async () => {
        throw new Error("mail provider refused");
      },
    };
    const deps = depsFor(repo, fixedObserver({ kind: "observed", value: 5, computedAt: T0 }), notifier);

    const report = await sweepMonitors(deps, T0);

    expect(report).toMatchObject({ evaluated: 2, fired: 2, notified: 0, notifyFailures: 2 });
    expect(repo.saved).toHaveLength(2);
  });

  test("one monitor's failure does not end the sweep", async () => {
    const repo = new FakeMonitors([
      aMonitor({ id: "mon_1", threshold: Threshold.above(1) }),
      aMonitor({ id: "mon_2", threshold: Threshold.above(1) }),
    ]);
    let calls = 0;
    const observe: ScalarObserver<Analysis> = async () => {
      calls += 1;
      if (calls === 1) throw new Error("row would not decode");
      return { kind: "observed", value: 7, computedAt: T0 };
    };

    const report = await sweepMonitors(depsFor(repo, observe), T0);

    expect(report).toMatchObject({ considered: 2, errors: 1, evaluated: 1, fired: 1 });
  });

  test("a monitor inside its cooldown is counted silent and sends nothing", async () => {
    const monitor = aMonitor({
      threshold: Threshold.above(1),
      channels: [EMAIL],
      cooldown: Duration.hours(1),
    });
    const repo = new FakeMonitors([monitor]);
    const notifier = recordingNotifier();
    const deps = depsFor(repo, fixedObserver({ kind: "observed", value: 5, computedAt: T0 }), notifier);

    await sweepMonitors(deps, T0);
    const second = await sweepMonitors(deps, Instant.plus(T0, Duration.minutes(5)));

    expect(second).toMatchObject({ fired: 0, silent: 1 });
    expect(notifier.sent).toHaveLength(1);
  });

  test("a restarted dispatcher retries a failed recipient without another evaluation or successful sibling send", async () => {
    const monitor = aMonitor({ threshold: Threshold.above(1), channels: [EMAIL, HOOK] });
    const repo = new FakeMonitors([monitor]);
    const sent: Notification[] = [];
    const first = depsFor(repo, fixedObserver({ kind: "observed", value: 5, computedAt: T0 }), {
      deliver: async (notification) => {
        if (notification.channel === "webhook") throw new Error("network down");
        sent.push(notification);
      },
    });
    expect(await sweepMonitors(first, T0)).toMatchObject({ fired: 1, notified: 1, notifyFailures: 1 });
    expect(repo.queue.size).toBe(1);
    const id = [...repo.queue.keys()][0];
    const restarted = depsFor(repo, async () => { throw new Error("must not re-evaluate to retry a delivery"); }, {
      deliver: async (notification) => { sent.push(notification); },
    });
    expect(await deliverMonitorAlerts(restarted, Instant.plus(T0, Duration.minutes(1))))
      .toEqual({ notified: 1, notifyFailures: 0 });
    expect(sent.map((notification) => notification.channel)).toEqual(["email", "webhook"]);
    expect(sent[1]?.id).toBe(id);
    expect(repo.queue.size).toBe(0);
  });

  test("failed measurements keep the prior reading but expose failed freshness", async () => {
    const monitor = aMonitor({ threshold: Threshold.above(10) });
    const repo = new FakeMonitors([monitor]);
    await sweepMonitors(depsFor(repo, fixedObserver({ kind: "observed", value: 5, computedAt: T0 })), T0);
    const later = Instant.plus(T0, Duration.minutes(1));
    await sweepMonitors(depsFor(repo, fixedObserver({ kind: "unobservable", detail: "deadline exceeded", retriable: true })), later);
    const loaded = await repo.find(monitor.id);
    expect(loaded?.lastValue).toBe(5);
    expect(loaded?.lastMeasuredAt).toEqual(T0);
    expect(loaded?.lastAttemptAt).toEqual(later);
    expect(loaded?.evaluationError).toBe("deadline exceeded");
  });

  test("later monitors use a fresh observation window when an earlier check took time", async () => {
    const repo = new FakeMonitors([
      aMonitor({ id: "mon_1", threshold: Threshold.above(10) }),
      aMonitor({ id: "mon_2", threshold: Threshold.above(10) }),
    ]);
    const clock = movableClock();
    const seen: Instant[] = [];
    const deps = depsFor(repo, async (_monitor, at) => {
      seen.push(at);
      clock.set(Instant.plus(at, Duration.minutes(2)));
      return { kind: "observed", value: 1, computedAt: at };
    });
    await sweepMonitors({ ...deps, monitors: { ...deps.monitors, clock } }, T0);
    expect(seen).toEqual([T0, Instant.plus(T0, Duration.minutes(2))]);
    expect((await repo.find("mon_2" as never))?.lastMeasuredAt).toEqual(seen[1]!);
  });
});

describe("what a firing monitor says", () => {
  const monitor = aMonitor({ threshold: Threshold.above(10), channels: [EMAIL, HOOK] });

  test("the webhook id is stable across redeliveries of the same event", () => {
    const event = {
      kind: "MonitorFired" as const,
      monitor: monitor.id,
      project: monitor.project,
      observed: 42,
      threshold: monitor.threshold,
      entering: true,
      at: T0,
    };

    const first = notificationsFor(monitor, event);
    const second = notificationsFor(monitor, event);
    const hook = first.find((n) => n.channel === "webhook");
    const again = second.find((n) => n.channel === "webhook");

    expect(hook?.channel === "webhook" && again?.channel === "webhook").toBe(true);
    expect(hook?.channel === "webhook" ? hook.id : null).toBe(
      again?.channel === "webhook" ? again.id : "different",
    );
  });

  test("an event that is not a state change says nothing", () => {
    expect(
      notificationsFor(monitor, { kind: "MonitorRenamed", monitor: monitor.id, name: "x", at: T0 }),
    ).toEqual([]);
  });

  test("a recovery reads as a recovery, not as a second breach", () => {
    const notifications = notificationsFor(monitor, {
      kind: "MonitorRecovered",
      monitor: monitor.id,
      project: monitor.project,
      observed: 3,
      at: T0,
    });
    const email = notifications.find((n) => n.channel === "email");

    expect(email?.channel === "email" ? email.subject : "").toContain("recovered");
  });
});
