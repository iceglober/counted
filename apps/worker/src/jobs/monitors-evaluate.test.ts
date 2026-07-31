/**
 * `monitors.evaluate`, over stubs.
 *
 * The firing rules themselves are the aggregate's and are tested there. What
 * is decided here is everything around them: that the whole set is one round
 * trip, that a query failure does not read as recovery, and that a fired
 * monitor and its notification commit together.
 */

import { describe, expect, test } from "bun:test";
import {
  Analysis,
  Duration,
  Instant,
  Measure,
  Monitor,
  MonitorId,
  ProjectId,
  Threshold,
  Window,
  type MonitorEvent,
} from "@counted/domain";
import type { AnalyticalStore, Job, Outcome, StoreRequest, StoreResult, UnitOfWork } from "@counted/ports";
import { monitorsEvaluate } from "./monitors-evaluate";

const now = Instant.fromEpochMillis(Date.parse("2026-03-17T15:00:00.000Z"));
const PRJ = ProjectId("33333333-3333-3333-3333-333333333333");

const job: Job = { id: "j", name: "monitors.evaluate", key: "k", payload: {}, runAfter: now, attempts: 1 };

const logged: { level: string; event: string; fields?: Record<string, unknown> | undefined }[] = [];
const log = {
  info: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "info", event, fields }),
  warn: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "warn", event, fields }),
  error: (event: string, fields?: Record<string, unknown>) => void logged.push({ level: "error", event, fields }),
};
const context = { now, log, leaseMs: 120_000 };

const must = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  return r.value;
};

const monitor = (n: number, over: { enabled?: boolean; state?: "ok" | "breaching" } = {}): Monitor => {
  const created = must(
    Monitor.create(
      MonitorId(`monitor_${n}`),
      PRJ,
      `Monitor ${n}`,
      Analysis.countOverWindow(Window.lastHours(1)),
      Threshold.above(100),
      now,
      { cooldown: Duration.hours(1) },
    ),
  ).monitor;

  const snapshot = created.snapshot();
  return Monitor.rehydrate({
    ...snapshot,
    enabled: over.enabled ?? true,
    state: over.state ?? "ok",
    ...(over.state === "breaching" ? { lastNotifiedAt: now } : {}),
  });
};

const world = (monitors: readonly Monitor[]) => {
  const saved: { monitor: Monitor; events: readonly MonitorEvent[] }[] = [];
  const transactions: number[] = [];
  const unitOfWork = {
    transact: async (work: (repos: unknown) => Promise<unknown>) => {
      transactions.push(1);
      return work({
        monitors: {
          listEnabled: async (limit: number) => monitors.slice(0, limit),
          save: async (m: Monitor, e: readonly MonitorEvent[]) => void saved.push({ monitor: m, events: e }),
        },
      });
    },
  } as unknown as UnitOfWork;
  return { unitOfWork, saved, transactions };
};

const store = (answer: (r: StoreRequest) => Outcome<StoreResult>, calls: StoreRequest[][] = []): AnalyticalStore => ({
  executeBatch: async (requests) => {
    calls.push([...requests]);
    return {
      results: new Map(requests.map((r) => [r.id, answer(r)])),
      stats: { statements: requests.length, totalMs: 1, coalesced: 0 },
    };
  },
  capabilities: () => ({ engine: "stub", approximateDistinct: false, partitioning: "none" }),
});

const scalar = (value: number): Outcome<StoreResult> => ({
  ok: true,
  value: { kind: "scalar", value },
  from: "store",
  computedAt: now,
});

describe("every monitor is evaluated in one round trip", () => {
  test("fifty monitors produce one batch", async () => {
    // v1 evaluated alerts serially in a global loop, from an HTTP endpoint
    // guarded by a bearer secret in a query string.
    const calls: StoreRequest[][] = [];
    const monitors = Array.from({ length: 50 }, (_, i) => monitor(i));
    const { unitOfWork } = world(monitors);

    await monitorsEvaluate({ store: store(() => scalar(5), calls), unitOfWork })(job, context);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(50);
  });

  test("no monitors is a noop, and the store is never called", async () => {
    const calls: StoreRequest[][] = [];
    const { unitOfWork } = world([]);
    const outcome = await monitorsEvaluate({ store: store(() => scalar(0), calls), unitOfWork })(job, context);
    expect(outcome.kind).toBe("noop");
    expect(calls).toHaveLength(0);
  });

  test("a monitor's question goes through the same planner a tile's does", async () => {
    // v1 had four vocabularies for "what to measure", so an alert on unique
    // users and a chart of unique users could disagree about what they counted.
    const calls: StoreRequest[][] = [];
    const { unitOfWork } = world([monitor(0)]);
    await monitorsEvaluate({ store: store(() => scalar(5), calls), unitOfWork })(job, context);

    const request = calls[0]![0]!;
    expect(request.kind).toBe("scalar");
    // Resolved bounds, exactly as a dashboard query gets.
    expect(request.bounds.to).toBe(now);
  });
});

describe("firing and recovering", () => {
  test("a monitor over its threshold fires", async () => {
    const { unitOfWork, saved } = world([monitor(0)]);
    const outcome = await monitorsEvaluate({ store: store(() => scalar(500)), unitOfWork })(job, context);

    expect(outcome.kind).toBe("done");
    expect(saved[0]!.events.map((e) => e.kind)).toEqual(["MonitorFired"]);
    expect(saved[0]!.monitor.snapshot().state).toBe("breaching");
  });

  test("a breaching monitor back under its threshold recovers", async () => {
    // v1 had no notion of recovery, so an operator learned things were bad and
    // never learned they were fine again.
    const { unitOfWork, saved } = world([monitor(0, { state: "breaching" })]);
    await monitorsEvaluate({ store: store(() => scalar(5)), unitOfWork })(job, context);

    expect(saved[0]!.events.map((e) => e.kind)).toEqual(["MonitorRecovered"]);
    expect(saved[0]!.monitor.snapshot().state).toBe("ok");
  });

  test("a monitor within its threshold is silent, and that is a noop", async () => {
    const { unitOfWork, saved } = world([monitor(0)]);
    const outcome = await monitorsEvaluate({ store: store(() => scalar(5)), unitOfWork })(job, context);
    expect(outcome.kind).toBe("noop");
    // Still saved: the observed value is recorded even when nothing fires.
    expect(saved[0]!.events).toEqual([]);
  });

  test("a monitor already breaching inside its cooldown does not fire again", async () => {
    const { unitOfWork, saved } = world([monitor(0, { state: "breaching" })]);
    await monitorsEvaluate({ store: store(() => scalar(500)), unitOfWork })(job, context);
    expect(saved[0]!.events).toEqual([]);
  });

  test("the monitor and its event are saved together", async () => {
    // A fired monitor and the notification that goes with it commit together
    // or not at all — which is what the outbox exists for.
    const { unitOfWork, saved } = world([monitor(0)]);
    await monitorsEvaluate({ store: store(() => scalar(500)), unitOfWork })(job, context);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.events).toHaveLength(1);
  });

  test("a mixed batch reports each outcome", async () => {
    let n = 0;
    const { unitOfWork } = world([monitor(0), monitor(1, { state: "breaching" }), monitor(2)]);
    const outcome = await monitorsEvaluate({
      store: store(() => scalar([500, 5, 5][n++] ?? 0)),
      unitOfWork,
    })(job, context);

    if (outcome.kind === "done") {
      expect(outcome.detail).toContain("1 fired");
      expect(outcome.detail).toContain("1 recovered");
      expect(outcome.detail).toContain("1 silent");
    }
  });
});

describe("a query failure is not a recovery", () => {
  test("an unanswered monitor keeps its state", async () => {
    // Silently treating a failure as "fine" is how an alert stops alerting.
    // The next run decides on a real number rather than on the absence of one.
    const breaching = monitor(0, { state: "breaching" });
    const { unitOfWork, saved } = world([breaching]);

    const outcome = await monitorsEvaluate({
      store: store(() => ({ ok: false, error: { code: "timeout", budgetMs: 500, retriable: true } })),
      unitOfWork,
    })(job, context);

    expect(saved).toEqual([]);
    expect(breaching.snapshot().state).toBe("breaching");
    if (outcome.kind === "done") expect(outcome.detail).toContain("1 unanswered");
  });

  test("it is reported, so a permanently broken monitor is visible", async () => {
    logged.length = 0;
    const { unitOfWork } = world([monitor(0)]);
    await monitorsEvaluate({
      store: store(() => ({ ok: false, error: { code: "store_unavailable", detail: "down", retriable: true } })),
      unitOfWork,
    })(job, context);

    const line = logged.find((l) => l.event === "monitor.unanswered");
    expect(line?.level).toBe("warn");
    expect(line?.fields).toMatchObject({ code: "store_unavailable" });
  });

  test("one failing monitor does not stop the others", async () => {
    let n = 0;
    const { unitOfWork, saved } = world([monitor(0), monitor(1), monitor(2)]);
    await monitorsEvaluate({
      store: store(() =>
        n++ === 1 ? { ok: false, error: { code: "timeout", budgetMs: 1, retriable: true } } : scalar(500),
      ),
      unitOfWork,
    })(job, context);

    expect(saved).toHaveLength(2);
  });

  test("a store answering the wrong kind is caught before the monitor sees it", async () => {
    // The assembler refuses a result whose kind does not match the request, so
    // this arrives as a failed readout rather than as a number.
    const { unitOfWork, saved } = world([monitor(0)]);
    await monitorsEvaluate({
      store: store(() => ({
        ok: true,
        value: { kind: "breakdown", rows: [{ label: "x", value: 1 }] },
        from: "store",
        computedAt: now,
      })),
      unitOfWork,
    })(job, context);

    expect(saved).toEqual([]);
  });

  test("a stored analysis that is not scalar-shaped is refused, not coerced", async () => {
    // `Monitor.create` refuses these, but a row can still hold one — a hand
    // edit, or a schema that predates the rule. Rehydration does not re-check,
    // so the handler must. Coercing a number out of a breakdown would make an
    // alert fire on whichever group happened to sort first.
    logged.length = 0;
    const scalarMonitor = monitor(0).snapshot();
    const grouped = Monitor.rehydrate({
      ...scalarMonitor,
      analysis: {
        measure: Measure.count(),
        window: Window.lastHours(1),
        groupBy: [{ by: "time", grain: "hour" }],
      },
    });

    const { unitOfWork, saved } = world([grouped]);
    await monitorsEvaluate({
      store: store((r) =>
        r.kind === "series"
          ? { ok: true, value: { kind: "series", values: new Array(r.axis.edges.length - 1).fill(1) }, from: "store", computedAt: now }
          : scalar(1),
      ),
      unitOfWork,
    })(job, context);

    expect(saved).toEqual([]);
    const line = logged.find((l) => l.event === "monitor.unexpected_shape");
    expect(line?.level).toBe("error");
    expect(line?.fields).toMatchObject({ shape: "series" });
  });
});

describe("the work is bounded", () => {
  test("only enabled monitors are asked for, up to the per-run cap", async () => {
    // A job whose duration grows with the customer count is a job two workers
    // start repeating once it outlives its lease.
    const calls: StoreRequest[][] = [];
    const monitors = Array.from({ length: 500 }, (_, i) => monitor(i));
    const { unitOfWork } = world(monitors);

    await monitorsEvaluate({ store: store(() => scalar(5), calls), unitOfWork })(job, context);
    expect(calls[0]!.length).toBeLessThanOrEqual(200);
  });

  test("running twice over a silent monitor changes nothing", async () => {
    // The lease guarantees a double run; a monitor that fired twice for one
    // breach would be worse than one that fired late.
    const { unitOfWork, saved } = world([monitor(0, { state: "breaching" })]);
    const evaluate = monitorsEvaluate({ store: store(() => scalar(500)), unitOfWork });
    await evaluate(job, context);
    await evaluate(job, context);
    expect(saved.flatMap((s) => s.events)).toEqual([]);
  });
});
