/**
 * Monitor — a standing threshold over an Analysis.
 *
 * This is where "one definition, two consumers" stops being a claim. A monitor
 * holds the same `Analysis` a dashboard tile holds. v1 forked it instead:
 * `alerts.metric` was a free-text column with its own hand-rolled compiler
 * supporting only `count | unique_sessions | <property SUM>`;
 * `alerts.eventFilter` was a single event name where insights took an array;
 * and `alerts.window` was a string parsed by `/^(\d+)(h|d)$/`, so a monitor
 * configured for `"1w"` silently fell through to one hour and measured
 * something nobody asked for. The threshold itself was stored as text and
 * recovered with `parseFloat`.
 *
 * Evaluation here is pure: given the number the store computed, decide what
 * should happen. Running the query and delivering the notification belong to
 * the worker (#56).
 */

import { assertNever } from "../shared/brand";
import { Duration } from "../shared/duration";
import { err, ok, type Result } from "../shared/result";
import { Instant } from "../shared/instant";
import type { Brand } from "../shared/brand";
import type { ProjectId } from "../shared/ids";
import { Analysis } from "../analytics/analysis";
import type { MonitorError } from "./errors";
import type { MonitorEvent } from "./events";

export type MonitorId = Brand<string, "MonitorId">;
export const MonitorId = (raw: string): MonitorId => raw as MonitorId;

/** A real number, compared against a real number. Not text. */
export type Threshold =
  | { readonly comparison: "above"; readonly value: number }
  | { readonly comparison: "below"; readonly value: number };

export const Threshold = {
  above: (value: number): Threshold => ({ comparison: "above", value }),
  below: (value: number): Threshold => ({ comparison: "below", value }),

  isBreached: (t: Threshold, observed: number): boolean => {
    switch (t.comparison) {
      case "above":
        return observed > t.value;
      case "below":
        return observed < t.value;
      default:
        return assertNever(t);
    }
  },

  describe: (t: Threshold): string =>
    t.comparison === "above" ? `above ${t.value}` : `below ${t.value}`,
} as const;

export type Channel =
  | { readonly kind: "email"; readonly address: string }
  | { readonly kind: "webhook"; readonly url: string };

/** Whether the monitor was in breach at its last evaluation. */
export type MonitorState = "ok" | "breaching";

export const DEFAULT_COOLDOWN = Duration.hours(1);

export type MonitorSnapshot = {
  readonly id: MonitorId;
  readonly project: ProjectId;
  readonly name: string;
  readonly analysis: Analysis;
  readonly threshold: Threshold;
  readonly cooldown: Duration;
  readonly channels: readonly Channel[];
  readonly enabled: boolean;
  readonly state: MonitorState;
  readonly lastNotifiedAt: Instant | null;
  readonly lastValue: number | null;
};

/**
 * What an evaluation concluded. `silent` carries its reason, so an operator
 * asking "why didn't this fire?" gets an answer instead of a shrug.
 */
export type MonitorDecision =
  | { readonly kind: "fire"; readonly observed: number; readonly threshold: Threshold; readonly entering: boolean }
  | { readonly kind: "recover"; readonly observed: number }
  | {
      readonly kind: "silent";
      readonly reason: "disabled" | "within-threshold" | "cooling-down";
      readonly observed: number;
    };

export type MonitorApplied = {
  readonly monitor: Monitor;
  readonly events: readonly MonitorEvent[];
};

export class Monitor {
  private constructor(private readonly s: MonitorSnapshot) {}

  static create(
    id: MonitorId,
    project: ProjectId,
    name: string,
    analysis: Analysis,
    threshold: Threshold,
    at: Instant,
    options: { cooldown?: Duration; channels?: readonly Channel[] } = {},
  ): Result<MonitorApplied, MonitorError> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });

    const cooldown = options.cooldown ?? DEFAULT_COOLDOWN;
    if (Duration.toMillis(cooldown) < 0) return err({ kind: "NegativeCooldown" });

    const shaped = Monitor.requireScalar(analysis);
    if (!shaped.ok) return shaped;

    const monitor = new Monitor({
      id,
      project,
      name: trimmed,
      analysis,
      threshold,
      cooldown,
      channels: options.channels ?? [],
      enabled: true,
      state: "ok",
      lastNotifiedAt: null,
      lastValue: null,
    });

    return ok({
      monitor,
      events: [{ kind: "MonitorCreated", monitor: id, project, name: trimmed, at }],
    });
  }

  static rehydrate(s: MonitorSnapshot): Monitor {
    return new Monitor(s);
  }

  /**
   * A monitor compares one number, so its analysis must produce one. A
   * grouped analysis yields a row per group and there is nothing to compare —
   * v1 could not express this constraint because alerts had their own
   * vocabulary that simply had no notion of grouping.
   */
  private static requireScalar(a: Analysis): Result<Analysis, MonitorError> {
    if ((a.groupBy ?? []).length > 0) return err({ kind: "AnalysisMustBeScalar" });
    const valid = Analysis.validate(a);
    if (!valid.ok) return err({ kind: "InvalidAnalysis", detail: valid.error.kind });
    return ok(a);
  }

  snapshot(): MonitorSnapshot {
    return this.s;
  }

  get id(): MonitorId {
    return this.s.id;
  }
  get project(): ProjectId {
    return this.s.project;
  }
  get name(): string {
    return this.s.name;
  }
  get analysis(): Analysis {
    return this.s.analysis;
  }
  get threshold(): Threshold {
    return this.s.threshold;
  }
  get enabled(): boolean {
    return this.s.enabled;
  }
  get state(): MonitorState {
    return this.s.state;
  }
  get channels(): readonly Channel[] {
    return this.s.channels;
  }
  get lastValue(): number | null {
    return this.s.lastValue;
  }

  // ── evaluation ───────────────────────────────────────────────────────────

  /**
   * Decide what this observation means. Pure: no notification is sent, no
   * clock is read.
   *
   * A monitor fires when it enters breach, and again only once the cooldown
   * has elapsed while it stays in breach. It recovers when the value returns
   * inside the threshold — v1 had no notion of recovery at all, so an operator
   * learned that things were bad and never learned they were fine again.
   */
  decide(observed: number, now: Instant): MonitorDecision {
    if (!this.s.enabled) return { kind: "silent", reason: "disabled", observed };

    const breached = Threshold.isBreached(this.s.threshold, observed);

    if (!breached) {
      return this.s.state === "breaching"
        ? { kind: "recover", observed }
        : { kind: "silent", reason: "within-threshold", observed };
    }

    const entering = this.s.state === "ok";
    if (entering) {
      return { kind: "fire", observed, threshold: this.s.threshold, entering: true };
    }

    const since = this.s.lastNotifiedAt;
    if (since !== null) {
      const elapsed = Instant.between(since, now);
      if (Duration.toMillis(elapsed) < Duration.toMillis(this.s.cooldown)) {
        return { kind: "silent", reason: "cooling-down", observed };
      }
    }
    return { kind: "fire", observed, threshold: this.s.threshold, entering: false };
  }

  /** Record the outcome of a decision. */
  apply(decision: MonitorDecision, now: Instant): MonitorApplied {
    switch (decision.kind) {
      case "fire":
        return {
          monitor: this.with({ state: "breaching", lastNotifiedAt: now, lastValue: decision.observed }),
          events: [
            {
              kind: "MonitorFired",
              monitor: this.s.id,
              project: this.s.project,
              observed: decision.observed,
              threshold: this.s.threshold,
              entering: decision.entering,
              at: now,
            },
          ],
        };
      case "recover":
        return {
          monitor: this.with({ state: "ok", lastValue: decision.observed }),
          events: [
            {
              kind: "MonitorRecovered",
              monitor: this.s.id,
              project: this.s.project,
              observed: decision.observed,
              at: now,
            },
          ],
        };
      case "silent":
        return { monitor: this.with({ lastValue: decision.observed }), events: [] };
      default:
        return assertNever(decision);
    }
  }

  // ── commands ─────────────────────────────────────────────────────────────

  enable(at: Instant): Result<MonitorApplied, MonitorError> {
    if (this.s.enabled) return err({ kind: "AlreadyEnabled" });
    return ok({
      monitor: this.with({ enabled: true }),
      events: [{ kind: "MonitorEnabled", monitor: this.s.id, at }],
    });
  }

  /** Disabling also clears breach state, so re-enabling does not re-fire stale news. */
  disable(at: Instant): Result<MonitorApplied, MonitorError> {
    if (!this.s.enabled) return err({ kind: "AlreadyDisabled" });
    return ok({
      monitor: this.with({ enabled: false, state: "ok" }),
      events: [{ kind: "MonitorDisabled", monitor: this.s.id, at }],
    });
  }

  retarget(analysis: Analysis, threshold: Threshold, at: Instant): Result<MonitorApplied, MonitorError> {
    const shaped = Monitor.requireScalar(analysis);
    if (!shaped.ok) return shaped;
    return ok({
      // Changing what is measured resets breach state; the old state described
      // a different question.
      monitor: this.with({ analysis, threshold, state: "ok", lastNotifiedAt: null, lastValue: null }),
      events: [{ kind: "MonitorRetargeted", monitor: this.s.id, at }],
    });
  }

  private with(patch: Partial<MonitorSnapshot>): Monitor {
    return new Monitor({ ...this.s, ...patch });
  }
}
