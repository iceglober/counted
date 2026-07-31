/**
 * `monitors.evaluate` — decide whether each enabled monitor should fire.
 *
 * Every enabled monitor's question goes to the store in **one batch**, through
 * the same planner and the same assembler a dashboard tile uses. That shared
 * path is the point: v1 had four different vocabularies for "what to measure"
 * — one for insights, one for alerts, and two more in between — so an alert on
 * "unique users" and a chart of "unique users" could disagree about what they
 * were counting, and did.
 *
 * v1 also evaluated alerts serially, in a global loop, from an HTTP endpoint
 * guarded by a bearer secret in a query string. Here it is a job: claimed with
 * a lease, safe on several replicas, and one round trip for the whole set.
 *
 * The decision itself is pure and lives on the aggregate. Nothing in this file
 * decides whether a monitor is breaching; it fetches numbers, hands them over,
 * and writes down what came back.
 */

import { Instant, ReadoutId, type Monitor, type MonitorDecision } from "@counted/domain";
import { runQuestions, type Ask } from "@counted/application";
import type { AnalyticalStore, UnitOfWork } from "@counted/ports";
import type { Handler } from "../runtime";

/**
 * How many monitors one run evaluates.
 *
 * Bounded so the job's duration does not grow with the customer count — a job
 * that outlives its lease is a job two workers start repeating.
 */
export const MONITORS_PER_RUN = 200;

/** The whole batch's budget. Well inside the schedule's two-minute lease. */
export const EVALUATE_DEADLINE_MS = 30_000;

export type MonitorDeps = {
  readonly store: AnalyticalStore;
  readonly unitOfWork: UnitOfWork;
};

export const monitorsEvaluate = (deps: MonitorDeps): Handler => async (_job, context) => {
  const monitors = await deps.unitOfWork.transact((repos) => repos.monitors.listEnabled(MONITORS_PER_RUN));
  if (monitors.length === 0) return { kind: "noop", detail: "no enabled monitors" };

  const byId = new Map<string, Monitor>();
  const asks: Ask[] = [];
  for (const monitor of monitors) {
    const snapshot = monitor.snapshot();
    const id = String(snapshot.id);
    byId.set(id, monitor);
    asks.push({
      id: ReadoutId(id),
      project: snapshot.project,
      // A monitor's question is an `Analysis`, the same type a tile holds.
      // There is no second measure vocabulary to disagree with the first.
      question: { kind: "analysis", analysis: snapshot.analysis },
    });
  }

  // One round trip for every monitor, not one per monitor.
  const { readouts, statements } = await runQuestions(deps.store, asks, {
    now: context.now,
    deadlineMs: EVALUATE_DEADLINE_MS,
    traceId: `monitors-${Instant.toEpochMillis(context.now)}`,
  });

  let fired = 0;
  let recovered = 0;
  let silent = 0;
  let unanswered = 0;

  for (const readout of readouts) {
    const monitor = byId.get(String(readout.id));
    if (monitor === undefined) continue;

    if (!readout.ok) {
      // A monitor whose query failed is not a monitor that recovered. Leaving
      // its state alone means the next run decides on a real number rather
      // than on the absence of one — silently treating a failure as "fine" is
      // how an alert stops alerting.
      unanswered += 1;
      context.log.warn("monitor.unanswered", {
        monitorId: String(readout.id),
        code: readout.failure.code,
        detail: readout.failure.detail,
      });
      continue;
    }

    if (readout.value.shape !== "scalar") {
      // `Monitor.create` refuses anything that is not scalar-shaped, so this
      // is a planner disagreement rather than a bad monitor — worth saying so
      // rather than coercing a number out of it.
      unanswered += 1;
      context.log.error("monitor.unexpected_shape", {
        monitorId: String(readout.id),
        shape: readout.value.shape,
      });
      continue;
    }

    const decision = monitor.decide(readout.value.value, context.now);
    const applied = monitor.apply(decision, context.now);

    // Saved with its events, in one transaction: a fired monitor and the
    // notification that goes with it commit together or not at all.
    await deps.unitOfWork.transact(async (repos) => {
      await repos.monitors.save(applied.monitor, applied.events);
    });

    tally(decision, () => (fired += 1), () => (recovered += 1), () => (silent += 1));

    if (decision.kind !== "silent") {
      context.log.info("monitor.decided", {
        monitorId: String(readout.id),
        decision: decision.kind,
        observed: decision.observed,
        ...(decision.kind === "fire" ? { entering: decision.entering } : {}),
      });
    }
  }

  if (fired === 0 && recovered === 0 && unanswered === 0) {
    return { kind: "noop", detail: `${silent} monitors within threshold` };
  }

  context.log.info("monitors.evaluated", {
    monitors: monitors.length,
    statements,
    fired,
    recovered,
    silent,
    unanswered,
  });

  return {
    kind: "done",
    detail: `${fired} fired, ${recovered} recovered, ${silent} silent, ${unanswered} unanswered`,
  };
};

const tally = (
  decision: MonitorDecision,
  onFire: () => void,
  onRecover: () => void,
  onSilent: () => void,
): void => {
  switch (decision.kind) {
    case "fire":
      onFire();
      return;
    case "recover":
      onRecover();
      return;
    case "silent":
      onSilent();
  }
};
