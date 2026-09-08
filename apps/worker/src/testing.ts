/**
 * Fakes for the worker's tests. Not exported from `index.ts` — nothing outside
 * this app has any use for them, and shipping them alongside the real wiring is
 * how a `recordingNotifier` ends up in production.
 */

import { Monitor, alertsFor, type MonitorAlert, type MonitorEvent, type Threshold } from "@counted/dashboarding-domain";
import type { MonitorDelivery, MonitorRepository } from "@counted/dashboarding-ports";
import { Analysis, Measure, Window, type Analysis as AnalysisType } from "@counted/analytics-domain";
import {
  Duration,
  Instant,
  MonitorId,
  ProjectId,
  WorkspaceId,
  type EventEnvelope,
} from "@counted/kernel";
import type { Clock, IdGenerator } from "@counted/kernel/ports";
import type { Outbox } from "@counted/persistence-ports";

export const T0 = Instant.fromEpochMillis(1_700_000_000_000);

export const W1 = WorkspaceId("ws_1");
export const P1 = ProjectId("pr_1");

export const countingIds = (prefix = "id"): IdGenerator => {
  let n = 0;
  return { next: () => `${prefix}_${++n}` };
};

export const movableClock = (start: Instant = T0): Clock & { set(at: Instant): void } => {
  let at = start;
  return { now: () => at, set: (next) => { at = next; } };
};

export const scalarAnalysis = (): AnalysisType =>
  Analysis.countOverWindow(Window.lastDays(1), "total");

export const uniqueVisitsAnalysis = (): AnalysisType => ({
  shape: "scalar",
  measure: Measure.uniqueVisits(),
  window: Window.lastDays(1),
  summary: "total",
});

export const aMonitor = (options: {
  readonly id?: string;
  readonly threshold: Threshold;
  readonly analysis?: AnalysisType;
  readonly channels?: Monitor<AnalysisType>["channels"];
  readonly cooldown?: Duration;
}): Monitor<AnalysisType> => {
  const created = Monitor.create<AnalysisType>(
    MonitorId(options.id ?? "mon_1"),
    W1,
    P1,
    "Signups",
    options.analysis ?? scalarAnalysis(),
    options.threshold,
    T0,
    {
      ...(options.cooldown === undefined ? {} : { cooldown: options.cooldown }),
      ...(options.channels === undefined ? {} : { channels: options.channels }),
    },
  );
  if (!created.ok) throw new Error(`fixture monitor did not build: ${created.error.kind}`);
  return created.value.monitor;
};

export class FakeMonitors implements MonitorRepository<Monitor<AnalysisType>, MonitorEvent> {
  readonly saved: { monitor: Monitor<AnalysisType>; events: readonly MonitorEvent[] }[] = [];
  #rows = new Map<string, Monitor<AnalysisType>>();
  readonly queue = new Map<string, { alert: MonitorAlert; attempts: number; next: Instant; claimedAt?: Instant }>();

  /** `onSave` exists so a test can observe the ordering of save against send. */
  constructor(
    monitors: readonly Monitor<AnalysisType>[] = [],
    private readonly onSave: () => void = () => undefined,
  ) {
    for (const monitor of monitors) this.#rows.set(String(monitor.id), monitor);
  }

  async find(id: MonitorId): Promise<Monitor<AnalysisType> | null> {
    return this.#rows.get(String(id)) ?? null;
  }
  async listForProject(): Promise<readonly Monitor<AnalysisType>[]> {
    return [...this.#rows.values()];
  }
  async listForWorkspace(): Promise<readonly Monitor<AnalysisType>[]> {
    return [...this.#rows.values()];
  }
  async listEnabled(limit: number): Promise<readonly Monitor<AnalysisType>[]> {
    return [...this.#rows.values()].filter((m) => m.enabled)
      .sort((a, b) => (a.lastAttemptAt === null ? -Infinity : Instant.toEpochMillis(a.lastAttemptAt)) - (b.lastAttemptAt === null ? -Infinity : Instant.toEpochMillis(b.lastAttemptAt)))
      .slice(0, limit);
  }
  async claimEnabled(limit: number, at: Instant, exclude: readonly MonitorId[] = []): Promise<readonly Monitor<AnalysisType>[]> {
    const due = (await this.listEnabled(Number.MAX_SAFE_INTEGER)).filter((m) => !exclude.includes(m.id)).slice(0, limit);
    for (const monitor of due) this.#rows.set(String(monitor.id), Monitor.rehydrate({ ...monitor.snapshot(), lastAttemptAt: at }));
    return due;
  }
  async claimDeliveries(limit: number, at: Instant): Promise<readonly MonitorDelivery[]> {
    return [...this.queue.values()].filter((d) => Instant.toEpochMillis(d.next) <= Instant.toEpochMillis(at))
      .filter((d) => ![...this.queue.values()].some((p) => p !== d && p.alert.monitor === d.alert.monitor && JSON.stringify(p.alert.channel) === JSON.stringify(d.alert.channel) && p.alert.occurredAt < d.alert.occurredAt))
      .slice(0, limit).map((d) => { d.attempts += 1; d.claimedAt = at; return { alert: d.alert, attempts: d.attempts, claimedAt: at }; });
  }
  async completeDelivery(delivery: MonitorDelivery): Promise<void> { this.queue.delete(delivery.alert.id); }
  async failDelivery(delivery: MonitorDelivery, _error: string, at: Instant): Promise<void> {
    const row = this.queue.get(delivery.alert.id)!;
    row.next = Instant.plus(at, Duration.seconds(30));
  }
  async save(monitor: Monitor<AnalysisType>, events: readonly MonitorEvent[]): Promise<void> {
    this.onSave();
    this.#rows.set(String(monitor.id), monitor);
    this.saved.push({ monitor, events });
    for (const alert of events.flatMap((event) => alertsFor(monitor, event))) {
      if (!this.queue.has(alert.id)) this.queue.set(alert.id, { alert, attempts: 0, next: Instant.fromEpochMillis(Date.parse(alert.occurredAt)) });
    }
  }
  async delete(id: MonitorId): Promise<void> {
    this.#rows.delete(String(id));
  }
}

/** An outbox that keeps everything in memory, including the attempt counts. */
export class FakeOutbox implements Outbox {
  readonly dispatched: string[] = [];
  readonly failures: { id: string; error: string }[] = [];
  #pending: EventEnvelope[] = [];
  #attempts = new Map<string, number>();

  constructor(pending: readonly EventEnvelope[] = []) {
    this.#pending = [...pending];
  }

  async enqueue(events: readonly EventEnvelope[]): Promise<void> {
    this.#pending.push(...events);
  }
  async claim(limit: number): Promise<readonly EventEnvelope[]> {
    return this.#pending.slice(0, limit);
  }
  async markDispatched(ids: readonly string[]): Promise<void> {
    this.dispatched.push(...ids);
    this.#pending = this.#pending.filter((e) => !ids.includes(e.id));
  }
  async recordFailure(id: string, error: string): Promise<number> {
    const attempts = (this.#attempts.get(id) ?? 0) + 1;
    this.#attempts.set(id, attempts);
    this.failures.push({ id, error });
    return attempts;
  }
  async pendingCount(): Promise<number> {
    return this.#pending.length;
  }
  setAttempts(id: string, attempts: number): void {
    this.#attempts.set(id, attempts);
  }
}

export const anEnvelope = (id: string): EventEnvelope => ({
  id,
  type: "dashboarding.MonitorFired",
  occurredAt: T0,
  payload: { kind: "MonitorFired", at: T0 },
});
