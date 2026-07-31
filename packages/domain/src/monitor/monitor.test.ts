import { describe, expect, test } from "bun:test";
import { ProjectId } from "../shared/ids";
import { Duration, Instant } from "../shared";
import { Analysis, Dimension, FieldRef, Measure, Window } from "../analytics";
import { Tile, TileId } from "../dashboard";
import {
  DEFAULT_COOLDOWN,
  Monitor,
  MonitorId,
  Threshold,
  type MonitorDecision,
} from "./monitor";
import type { MonitorError } from "./errors";

const t0 = Instant.fromEpochMillis(1_700_000_000_000);
const at = (d: Duration) => Instant.plus(t0, d);
const prj = ProjectId("prj_1");
const mid = MonitorId("mon_1");

/** Errors in the last hour — the canonical monitor question. */
const errorsLastHour = (): Analysis => ({
  measure: Measure.count(),
  events: ["error"],
  window: Window.lastHours(1),
});

const must = <T>(r: { ok: true; value: T } | { ok: false; error: MonitorError }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};
const errorOf = <T>(r: { ok: true; value: T } | { ok: false; error: MonitorError }): MonitorError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r.error;
};

const create = (threshold = Threshold.above(10), cooldown?: Duration) =>
  must(
    Monitor.create(mid, prj, "Errors", errorsLastHour(), threshold, t0, {
      ...(cooldown === undefined ? {} : { cooldown }),
    }),
  ).monitor;

/** Run a decision and apply it, the way the worker will. */
const tick = (m: Monitor, observed: number, now: Instant) => {
  const decision = m.decide(observed, now);
  return { decision, ...m.apply(decision, now) };
};

describe("a monitor holds the same Analysis a tile holds", () => {
  test("the identical question serves both, with one key", () => {
    const question = errorsLastHour();
    const monitor = must(Monitor.create(mid, prj, "Errors", question, Threshold.above(10), t0)).monitor;
    const tile = Tile.of(TileId("t1"), "Errors", prj, {
      kind: "analysis",
      analysis: question,
      view: "number",
    });

    expect(Analysis.toKey(monitor.analysis)).toBe(
      Analysis.toKey((tile.content as { analysis: Analysis }).analysis),
    );
  });

  test("windows are real windows — v1's regex turned an unrecognised one into an hour", () => {
    // alerts.window was text parsed by /^(\d+)(h|d)$/, so "1w" silently became
    // one hour and the monitor measured something nobody asked for.
    const weekly = must(
      Monitor.create(mid, prj, "Weekly", { measure: Measure.count(), window: Window.lastWeeks(1) }, Threshold.below(5), t0),
    ).monitor;
    expect(Window.toKey(weekly.analysis.window)).toBe("rel:1week");
  });

  test("any measure the IR supports works, not just three", () => {
    const revenue: Analysis = {
      measure: Measure.aggregate("sum", "amount"),
      events: ["purchase"],
      window: Window.lastDays(1),
    };
    expect(must(Monitor.create(mid, prj, "Revenue", revenue, Threshold.below(500), t0)).monitor.analysis.measure.kind)
      .toBe("aggregate");
  });
});

describe("validation", () => {
  test("a grouped analysis is refused — there is no single number to compare", () => {
    const grouped: Analysis = {
      measure: Measure.count(),
      groupBy: [Dimension.field(FieldRef.system("os_name"))],
      window: Window.lastHours(1),
    };
    expect(errorOf(Monitor.create(mid, prj, "Grouped", grouped, Threshold.above(1), t0)).kind)
      .toBe("AnalysisMustBeScalar");
  });

  test("a structurally invalid analysis is refused with its reason", () => {
    const bad: Analysis = { measure: Measure.count(), window: Window.lastDays(0) };
    expect(errorOf(Monitor.create(mid, prj, "Bad", bad, Threshold.above(1), t0)))
      .toMatchObject({ kind: "InvalidAnalysis", detail: "NonPositiveWindow" });
  });

  test("a blank name and a negative cooldown are refused", () => {
    expect(errorOf(Monitor.create(mid, prj, " ", errorsLastHour(), Threshold.above(1), t0)).kind)
      .toBe("NameRequired");
    expect(
      errorOf(
        Monitor.create(mid, prj, "x", errorsLastHour(), Threshold.above(1), t0, {
          cooldown: Duration.minutes(-1),
        }),
      ).kind,
    ).toBe("NegativeCooldown");
  });
});

describe("thresholds compare numbers, not text", () => {
  test("above and below", () => {
    expect(Threshold.isBreached(Threshold.above(10), 11)).toBe(true);
    expect(Threshold.isBreached(Threshold.above(10), 10)).toBe(false);
    expect(Threshold.isBreached(Threshold.below(5), 4)).toBe(true);
    expect(Threshold.isBreached(Threshold.below(5), 5)).toBe(false);
  });

  test("the value is a number all the way through", () => {
    // v1 stored threshold as text "for precision" and recovered it with
    // parseFloat on every evaluation.
    const m = create(Threshold.above(10.5));
    expect(typeof m.threshold.value).toBe("number");
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
    const again = tick(first, 20, at(Duration.hours(2)));
    expect(again.decision).toMatchObject({ kind: "fire", entering: false, observed: 20 });
  });

  test("the cooldown is configurable, not a hardcoded hour", () => {
    const m = create(Threshold.above(10), Duration.minutes(5));
    const fired = tick(m, 15, t0).monitor;
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
    const again = tick(recovered, 99, at(Duration.minutes(11)));
    expect(again.decision).toMatchObject({ kind: "fire", entering: true });
  });

  test("a healthy monitor stays silent and says why", () => {
    const { decision } = tick(create(), 2, t0);
    expect(decision).toMatchObject({ kind: "silent", reason: "within-threshold", observed: 2 });
  });

  test("every silent decision carries a reason an operator can read", () => {
    const reasons = new Set<string>();
    const healthy = tick(create(), 1, t0);
    reasons.add((healthy.decision as { reason: string }).reason);

    const breaching = tick(create(), 15, t0).monitor;
    reasons.add((tick(breaching, 15, at(Duration.minutes(1))).decision as { reason: string }).reason);

    const off = must(create().disable(t0)).monitor;
    reasons.add((off.decide(999, t0) as { reason: string }).reason);

    expect(reasons).toEqual(new Set(["within-threshold", "cooling-down", "disabled"]));
  });

  test("the last observed value is recorded even when nothing fires", () => {
    const { monitor } = tick(create(), 7, t0);
    expect(monitor.lastValue).toBe(7);
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

    const on = must(off.enable(at(Duration.minutes(2)))).monitor;
    // Still breaching in reality — so it fires as a fresh entry.
    expect(tick(on, 15, at(Duration.minutes(3))).decision).toMatchObject({ kind: "fire", entering: true });
  });

  test("redundant enable/disable are errors, not silent no-ops", () => {
    expect(errorOf(create().enable(t0)).kind).toBe("AlreadyEnabled");
    const off = must(create().disable(t0)).monitor;
    expect(errorOf(off.disable(t0)).kind).toBe("AlreadyDisabled");
  });
});

describe("retargeting", () => {
  test("changing the question resets breach state", () => {
    const breaching = tick(create(), 15, t0).monitor;
    const retargeted = must(
      breaching.retarget({ measure: Measure.count(), window: Window.lastDays(1) }, Threshold.below(1), t0),
    ).monitor;

    expect(retargeted.state).toBe("ok");
    expect(retargeted.lastValue).toBeNull();
    // The old breach described a different question, so it should not carry over.
    expect(tick(retargeted, 0, t0).decision).toMatchObject({ kind: "fire", entering: true });
  });

  test("retargeting to a grouped analysis is refused", () => {
    const grouped: Analysis = {
      measure: Measure.count(),
      groupBy: [Dimension.time("day")],
      window: Window.lastDays(7),
    };
    expect(errorOf(create().retarget(grouped, Threshold.above(1), t0)).kind).toBe("AnalysisMustBeScalar");
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
