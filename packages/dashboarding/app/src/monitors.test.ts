import { beforeEach, describe, expect, test } from "bun:test";
import { Duration, Instant, MonitorId, ProjectId, WorkspaceId, err, ok } from "@counted/kernel";
import type { Result } from "@counted/kernel";
import { Monitor, Threshold } from "@counted/dashboarding-domain";
import type { Channel, MonitorError } from "@counted/dashboarding-domain";
import {
  createMonitor,
  deleteMonitor,
  disableMonitor,
  dueMonitors,
  enableMonitor,
  evaluateMonitor,
  updateMonitor,
} from "./monitors";
import type { AnalysisCheck, MonitorDeps } from "./ports";
import { FakeMonitors, T0, countingIds, q, stepClock } from "./test-support";
import type { Q } from "./test-support";

const ws = WorkspaceId("ws_1");
const prj = ProjectId("prj_1");
const errors = q("count(error) over 1h");
const revenue = q("sum(amount, purchase) over 1d");
const grouped = q("count(error) by os over 1h");

const must = <T>(r: Result<T, MonitorError>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errorOf = <T>(r: Result<T, MonitorError>): MonitorError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r.error;
};

/**
 * Standing in for the check the composition root supplies over the real
 * Analysis IR. That it can be written here at all is the point: dashboarding
 * declares the requirement and analytics answers it.
 */
const isScalar: AnalysisCheck<Q> = (analysis) =>
  analysis.question.includes(" by ")
    ? err({ kind: "AnalysisMustBeScalar" })
    : ok(analysis);

let monitors: FakeMonitors;
let deps: MonitorDeps<Q>;

beforeEach(() => {
  monitors = new FakeMonitors();
  deps = { monitors, clock: stepClock(), ids: countingIds("mon"), isScalar };
});

const seeded = (id = "mon_seed", threshold = Threshold.above(10)) => {
  const m = must(
    Monitor.create<Q>(MonitorId(id), ws, prj, "Errors", errors, threshold, T0),
  ).monitor;
  monitors.seed(m);
  return m;
};

describe("create — absent from v2 entirely", () => {
  test("a monitor is minted, saved, and enabled from the start", async () => {
    const created = must(
      await createMonitor(deps, {
        workspace: ws,
        project: prj,
        name: "Errors",
        analysis: errors,
        threshold: Threshold.above(10),
      }),
    );

    expect(created.id).toBe(MonitorId("mon_1"));
    expect(created.enabled).toBe(true);
    expect(monitors.count).toBe(1);
    expect(monitors.saved[0]!.events[0]).toMatchObject({ kind: "MonitorCreated" });
  });

  test("an analysis that yields a row per group is refused before an id is spent", async () => {
    // There is no single number for a threshold to compare against. v1 could not
    // express this at all, because alerts had their own vocabulary with no
    // notion of grouping.
    expect(
      errorOf(
        await createMonitor(deps, {
          workspace: ws,
          project: prj,
          name: "By OS",
          analysis: grouped,
          threshold: Threshold.above(1),
        }),
      ).kind,
    ).toBe("AnalysisMustBeScalar");
    expect(monitors.count).toBe(0);
  });

  test("a negative cooldown is refused", async () => {
    expect(
      errorOf(
        await createMonitor(deps, {
          workspace: ws,
          project: prj,
          name: "Errors",
          analysis: errors,
          threshold: Threshold.above(1),
          cooldown: Duration.minutes(-5),
        }),
      ).kind,
    ).toBe("NegativeCooldown");
  });
});

describe("update — also absent from v2", () => {
  test("renaming writes one event and leaves the question alone", async () => {
    const m = seeded();
    const after = must(await updateMonitor(deps, { monitor: m.id, name: "Error rate" }));
    expect(after.name).toBe("Error rate");
    expect(after.analysis).toBe(errors);
    expect(monitors.saved[0]!.events.map((e) => e.kind)).toEqual(["MonitorRenamed"]);
  });

  test("retargeting is checked for scalarity too, and a grouped analysis leaves the monitor as it was", async () => {
    const m = seeded();
    expect(errorOf(await updateMonitor(deps, { monitor: m.id, analysis: grouped })).kind)
      .toBe("AnalysisMustBeScalar");
    expect((await monitors.find(m.id))?.analysis).toBe(errors);
    expect(monitors.saved).toHaveLength(0);
  });

  test("changing the threshold alone still resets breach state", async () => {
    const m = seeded();
    const breaching = m.apply(m.decide(50, T0), T0).monitor;
    monitors.seed(breaching);
    expect(breaching.state).toBe("breaching");

    const loosened = must(await updateMonitor(deps, { monitor: m.id, threshold: Threshold.above(100) }));
    expect(loosened.state).toBe("ok");
  });

  test("changing name, question and delivery in one call emits all three events in order", async () => {
    const channels: readonly Channel[] = [{ kind: "webhook", url: "https://example.com/hook" }];
    const m = seeded();
    const after = must(
      await updateMonitor(deps, {
        monitor: m.id,
        name: "Revenue",
        analysis: revenue,
        threshold: Threshold.below(500),
        cooldown: Duration.minutes(15),
        channels,
      }),
    );

    expect(after.name).toBe("Revenue");
    expect(after.analysis).toBe(revenue);
    expect(after.channels).toEqual(channels);
    expect(monitors.saved[0]!.events.map((e) => e.kind)).toEqual([
      "MonitorRenamed",
      "MonitorRetargeted",
      "MonitorReconfigured",
    ]);
  });

  test("muting a channel does not re-announce a breach that was already reported", async () => {
    const m = seeded();
    const breaching = m.apply(m.decide(50, T0), T0).monitor;
    monitors.seed(breaching);

    const quieter = must(await updateMonitor(deps, { monitor: m.id, cooldown: Duration.hours(6) }));
    expect(quieter.state).toBe("breaching");
  });

  test("an update that names nothing writes nothing", async () => {
    const m = seeded();
    expect(must(await updateMonitor(deps, { monitor: m.id })).name).toBe("Errors");
    expect(monitors.saved).toHaveLength(0);
  });

  test("a rename to the name it already has is refused", async () => {
    const m = seeded();
    expect(errorOf(await updateMonitor(deps, { monitor: m.id, name: "Errors" })).kind).toBe("NameUnchanged");
  });

  test("every command against a monitor that does not exist names the id", async () => {
    const missing = MonitorId("mon_nope");
    const expected = { kind: "NoSuchMonitor", monitor: missing };
    expect(errorOf(await updateMonitor(deps, { monitor: missing, name: "x" }))).toMatchObject(expected);
    expect(errorOf(await enableMonitor(deps, missing))).toMatchObject(expected);
    expect(errorOf(await disableMonitor(deps, missing))).toMatchObject(expected);
    expect(errorOf(await deleteMonitor(deps, missing))).toMatchObject(expected);
  });
});

describe("delete — also absent from v2", () => {
  test("a deleted monitor is gone, and a second delete says so", async () => {
    const m = seeded();
    must(await deleteMonitor(deps, m.id));
    expect(monitors.count).toBe(0);
    expect(errorOf(await deleteMonitor(deps, m.id)).kind).toBe("NoSuchMonitor");
  });
});

describe("enable and disable — the only half v2 shipped", () => {
  test("disabling then enabling round-trips, and repeats are refused", async () => {
    const m = seeded();
    expect(must(await disableMonitor(deps, m.id)).enabled).toBe(false);
    expect(errorOf(await disableMonitor(deps, m.id)).kind).toBe("AlreadyDisabled");
    expect(must(await enableMonitor(deps, m.id)).enabled).toBe(true);
    expect(errorOf(await enableMonitor(deps, m.id)).kind).toBe("AlreadyEnabled");
  });
});

describe("evaluation, the way the worker runs it", () => {
  test("a breach is decided, recorded and persisted in one tick", async () => {
    const m = seeded();
    const { decision, monitor, events } = await evaluateMonitor(deps, { monitor: m, observed: 50 });

    expect(decision).toMatchObject({ kind: "fire", entering: true, observed: 50 });
    expect(monitor.state).toBe("breaching");
    expect(events.map((e) => e.kind)).toEqual(["MonitorFired"]);
    expect((await monitors.find(m.id))?.state).toBe("breaching");
  });

  test("a quiet tick still records the number, so a stalled monitor is distinguishable", async () => {
    const m = seeded();
    const { decision, events } = await evaluateMonitor(deps, { monitor: m, observed: 3 });
    expect(decision).toMatchObject({ kind: "silent", reason: "within-threshold" });
    expect(events).toEqual([]);
    expect((await monitors.find(m.id))?.lastValue).toBe(3);
  });

  test("a recovery is announced — v1 said things were bad and never said they were fine", async () => {
    const clock = stepClock();
    deps = { ...deps, clock };
    const m = seeded();

    const breaching = (await evaluateMonitor(deps, { monitor: m, observed: 50 })).monitor;
    clock.set(Instant.plus(T0, Duration.minutes(10)));
    const recovered = await evaluateMonitor(deps, { monitor: breaching, observed: 1 });

    expect(recovered.decision.kind).toBe("recover");
    expect(recovered.events.map((e) => e.kind)).toEqual(["MonitorRecovered"]);
  });

  test("the worker's batch is enabled monitors only, in slices", async () => {
    seeded("mon_a");
    seeded("mon_b");
    const c = seeded("mon_c");
    await disableMonitor(deps, c.id);

    expect(await dueMonitors(deps, 10)).toHaveLength(2);
    expect(await dueMonitors(deps, 1)).toHaveLength(1);
  });
});
