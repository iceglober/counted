import { describe, expect, test } from "bun:test";
import { Duration, Instant, MonitorId, ProjectId, WorkspaceId } from "@counted/kernel";
import type { Result } from "@counted/kernel";
import { DEFAULT_COOLDOWN, Monitor } from "./monitor";
import { Threshold } from "./threshold";
import type { Channel, MonitorDecision, MonitorSettings } from "./monitor";
import type { MonitorError } from "./errors";

/** Opaque to this context — see monitor.ts. A stand-in is enough to test it. */
type Q = { readonly question: string };
const errorsLastHour: Q = { question: "count(error) over 1h" };
const revenueLastDay: Q = { question: "sum(amount, purchase) over 1d" };

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const at = (d: Duration) => Instant.plus(t0, d);
const ws = WorkspaceId("ws_1");
const prj = ProjectId("prj_1");
const mid = MonitorId("mon_1");

const must = <T>(r: Result<T, MonitorError>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errorOf = <T>(r: Result<T, MonitorError>): MonitorError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r.error;
};

const create = (threshold = Threshold.above(10), settings: MonitorSettings = {}) =>
  must(Monitor.create<Q>(mid, ws, prj, "Errors", errorsLastHour, threshold, t0, settings)).monitor;

/** One evaluation tick, the way the worker will run it. */
const tick = (m: Monitor<Q>, observed: number, now: Instant) => {
  const decision = m.decide(observed, now);
  return { decision, ...m.apply(decision, now) };
};

describe("a monitor holds the same question a tile holds", () => {
  test("the analysis is carried whole, not re-expressed in a second vocabulary", () => {
    // v1 gave alerts their own `metric` text column with a hand-rolled compiler
    // that understood three metrics, a single event name where insights took an
    // array, and a window parsed by /^(\d+)(h|d)$/ — so "1w" silently became one
    // hour and the monitor measured something nobody asked for.
    expect(create().analysis).toBe(errorsLastHour);
  });

  test("any question the analytics IR can express works, because this context does not inspect it", () => {
    const m = must(
      Monitor.create<Q>(mid, ws, prj, "Revenue", revenueLastDay, Threshold.below(500), t0),
    ).monitor;
    expect(m.analysis).toBe(revenueLastDay);
  });

  test("a monitor carries its workspace, so its placement needs no join", () => {
    expect(create().workspace).toBe(ws);
    expect(create().project).toBe(prj);
  });
});

describe("creation", () => {
  test("a blank name is refused, and a name is stored trimmed", () => {
    expect(errorOf(Monitor.create<Q>(mid, ws, prj, " ", errorsLastHour, Threshold.above(1), t0)).kind)
      .toBe("NameRequired");
    expect(
      must(Monitor.create<Q>(mid, ws, prj, "  Errors  ", errorsLastHour, Threshold.above(1), t0)).monitor.name,
    ).toBe("Errors");
  });

  test("a negative cooldown is refused", () => {
    expect(errorOf(
      Monitor.create<Q>(mid, ws, prj, "x", errorsLastHour, Threshold.above(1), t0, {
        cooldown: Duration.minutes(-1),
      }),
    ).kind).toBe("NegativeCooldown");
  });

  test("a new monitor starts enabled, healthy and unobserved", () => {
    const m = create();
    expect(m.enabled).toBe(true);
    expect(m.state).toBe("ok");
    expect(m.lastValue).toBeNull();
    expect(m.lastNotifiedAt).toBeNull();
  });

  test("creation announces itself with both ids the outbox will route on", () => {
    const { events } = must(
      Monitor.create<Q>(mid, ws, prj, "Errors", errorsLastHour, Threshold.above(10), t0),
    );
    expect(events).toEqual([
      { kind: "MonitorCreated", monitor: mid, workspace: ws, project: prj, name: "Errors", at: t0 },
    ]);
  });
});

describe("thresholds compare numbers, not text", () => {
  test("above and below are strict", () => {
    expect(Threshold.isBreached(Threshold.above(10), 11)).toBe(true);
    expect(Threshold.isBreached(Threshold.above(10), 10)).toBe(false);
    expect(Threshold.isBreached(Threshold.below(5), 4)).toBe(true);
    expect(Threshold.isBreached(Threshold.below(5), 5)).toBe(false);
  });

  test("the value is a number all the way through", () => {
    // v1 stored the threshold as text "for precision" and recovered it with
    // parseFloat on every evaluation.
    expect(typeof create(Threshold.above(10.5)).threshold.value).toBe("number");
  });
});

describe("firing, cooldown and recovery", () => {
  test("it fires on entering breach", () => {
    const { decision, monitor } = tick(create(), 15, t0);
    expect(decision).toMatchObject({ kind: "fire", entering: true, observed: 15 });
    expect(monitor.state).toBe("breaching");
  });

  test("it stays quiet while still breaching inside the cooldown", () => {
    const first = tick(create(), 15, t0).monitor;
    const second = tick(first, 20, at(Duration.minutes(30)));
    expect(second.decision).toMatchObject({ kind: "silent", reason: "cooling-down" });
    expect(second.monitor.state).toBe("breaching");
  });

  test("it fires again once the cooldown has elapsed", () => {
    const first = tick(create(), 15, t0).monitor;
    expect(tick(first, 20, at(Duration.hours(2))).decision).toMatchObject({
      kind: "fire",
      entering: false,
      observed: 20,
    });
  });

  test("the cooldown is configurable, not a hardcoded hour", () => {
    const fired = tick(create(Threshold.above(10), { cooldown: Duration.minutes(5) }), 15, t0).monitor;
    expect(tick(fired, 15, at(Duration.minutes(3))).decision.kind).toBe("silent");
    expect(tick(fired, 15, at(Duration.minutes(6))).decision.kind).toBe("fire");
    expect(Duration.toMillis(DEFAULT_COOLDOWN)).toBe(3_600_000);
  });

  test("it recovers when the value comes back inside — v1 never said things were fine again", () => {
    const breaching = tick(create(), 15, t0).monitor;
    const recovered = tick(breaching, 3, at(Duration.minutes(10)));
    expect(recovered.decision).toMatchObject({ kind: "recover", observed: 3 });
    expect(recovered.monitor.state).toBe("ok");
    expect(recovered.events[0]).toMatchObject({ kind: "MonitorRecovered" });
  });

  test("recovery then a fresh breach fires as an entry, not a cooldown continuation", () => {
    const breaching = tick(create(), 15, t0).monitor;
    const recovered = tick(breaching, 3, at(Duration.minutes(10))).monitor;
    expect(tick(recovered, 99, at(Duration.minutes(11))).decision).toMatchObject({
      kind: "fire",
      entering: true,
    });
  });

  test("a healthy monitor stays silent and says why", () => {
    expect(tick(create(), 2, t0).decision).toMatchObject({
      kind: "silent",
      reason: "within-threshold",
      observed: 2,
    });
  });

  test("every silent decision carries a reason an operator can read", () => {
    const reasons = new Set<string>();
    reasons.add((tick(create(), 1, t0).decision as { reason: string }).reason);

    const breaching = tick(create(), 15, t0).monitor;
    reasons.add((tick(breaching, 15, at(Duration.minutes(1))).decision as { reason: string }).reason);

    const off = must(create().disable(t0)).monitor;
    reasons.add((off.decide(999, t0) as { reason: string }).reason);

    expect(reasons).toEqual(new Set(["within-threshold", "cooling-down", "disabled"]));
  });

  test("the last observed value is recorded even when nothing fires", () => {
    // A monitor that has never recorded a value and one that keeps recording
    // zeros look identical without this, so "is this thing even running?" has no
    // answer.
    expect(tick(create(), 7, t0).monitor.lastValue).toBe(7);
  });
});

describe("decisions are pure", () => {
  test("deciding twice gives the same answer and changes nothing", () => {
    const m = create();
    const a: MonitorDecision = m.decide(15, t0);
    const b: MonitorDecision = m.decide(15, t0);
    expect(a).toEqual(b);
    expect(m.state).toBe("ok");
    expect(m.lastValue).toBeNull();
  });

  test("rehydration preserves evaluation behaviour", () => {
    const breaching = tick(create(), 15, t0).monitor;
    const revived = Monitor.rehydrate(breaching.snapshot());
    expect(revived.state).toBe("breaching");
    expect(revived.decide(20, at(Duration.minutes(5)))).toMatchObject({
      kind: "silent",
      reason: "cooling-down",
    });
  });
});

describe("update — the half v2 never had", () => {
  test("renaming, and refusing a rename that changes nothing", () => {
    const renamed = must(create().rename("Error rate", t0)).monitor;
    expect(renamed.name).toBe("Error rate");
    expect(errorOf(create().rename("Errors", t0)).kind).toBe("NameUnchanged");
    expect(errorOf(create().rename("   ", t0)).kind).toBe("NameRequired");
  });

  test("renaming does not disturb breach state", () => {
    const breaching = tick(create(), 15, t0).monitor;
    expect(must(breaching.rename("Error rate", t0)).monitor.state).toBe("breaching");
  });

  test("retargeting changes the question and resets breach state", () => {
    const breaching = tick(create(), 15, t0).monitor;
    const retargeted = must(breaching.retarget(revenueLastDay, Threshold.below(1), t0)).monitor;

    expect(retargeted.analysis).toBe(revenueLastDay);
    expect(retargeted.state).toBe("ok");
    expect(retargeted.lastValue).toBeNull();
    // The old breach described a different question, so it must not carry over.
    expect(tick(retargeted, 0, t0).decision).toMatchObject({ kind: "fire", entering: true });
  });

  test("changing only the threshold is still a retarget, because what counts as bad changed", () => {
    const breaching = tick(create(Threshold.above(10)), 15, t0).monitor;
    const loosened = must(breaching.retarget(errorsLastHour, Threshold.above(100), t0)).monitor;
    expect(loosened.state).toBe("ok");
    expect(tick(loosened, 15, at(Duration.minutes(1))).decision).toMatchObject({
      kind: "silent",
      reason: "within-threshold",
    });
  });

  test("reconfiguring the cooldown keeps breach state — muting is not remeasuring", () => {
    const breaching = tick(create(), 15, t0).monitor;
    const quieter = must(breaching.reconfigure({ cooldown: Duration.hours(4) }, t0)).monitor;
    expect(quieter.state).toBe("breaching");
    expect(tick(quieter, 15, at(Duration.hours(2))).decision).toMatchObject({
      kind: "silent",
      reason: "cooling-down",
    });
  });

  test("reconfiguring channels leaves the cooldown alone, and vice versa", () => {
    const channels: readonly Channel[] = [{ kind: "email", address: "ops@example.com" }];
    const m = must(create(Threshold.above(10), { cooldown: Duration.minutes(5) }).reconfigure({ channels }, t0)).monitor;
    expect(m.channels).toEqual(channels);
    expect(Duration.toMillis(m.cooldown)).toBe(300_000);

    const back = must(m.reconfigure({ cooldown: Duration.minutes(9) }, t0)).monitor;
    expect(back.channels).toEqual(channels);
  });

  test("a negative cooldown is refused on update as well as on create", () => {
    expect(errorOf(create().reconfigure({ cooldown: Duration.seconds(-1) }, t0)).kind).toBe("NegativeCooldown");
  });
});

describe("enable and disable", () => {
  test("a disabled monitor never fires", () => {
    const off = must(create().disable(t0)).monitor;
    expect(off.decide(9_999, t0)).toMatchObject({ kind: "silent", reason: "disabled" });
  });

  test("disabling clears breach state, so re-enabling does not re-announce stale news", () => {
    const breaching = tick(create(), 15, t0).monitor;
    expect(breaching.state).toBe("breaching");

    const off = must(breaching.disable(at(Duration.minutes(1)))).monitor;
    expect(off.state).toBe("ok");
    // A historical reading remains paired with the time it was measured.
    expect(off.lastValue).toBe(15);
    expect(off.lastMeasuredAt).toBe(t0);

    const on = must(off.enable(at(Duration.minutes(2)))).monitor;
    // Re-enabling waits for a fresh measurement before reporting health.
    expect(on.lastValue).toBeNull();
    expect(on.lastMeasuredAt).toBeNull();
    expect(on.lastAttemptAt).toBeNull();
    // Still breaching in reality — so it fires as a fresh entry.
    expect(tick(on, 15, at(Duration.minutes(3))).decision).toMatchObject({
      kind: "fire",
      entering: true,
    });
  });

  test("redundant enable/disable are errors, not silent no-ops", () => {
    expect(errorOf(create().enable(t0)).kind).toBe("AlreadyEnabled");
    const off = must(create().disable(t0)).monitor;
    expect(errorOf(off.disable(t0)).kind).toBe("AlreadyDisabled");
  });
});
