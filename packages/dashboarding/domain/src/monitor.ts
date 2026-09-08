/**
 * Monitor — a standing threshold over an Analysis.
 *
 * This is where "one definition, two consumers" stops being a claim. A monitor
 * holds the same analysis a dashboard tile holds. v1 forked it instead:
 * `alerts.metric` was a free-text column with its own hand-rolled compiler
 * supporting only `count | unique_sessions | <property SUM>`;
 * `alerts.eventFilter` was a single event name where insights took an array;
 * and `alerts.window` was a string parsed by `/^(\d+)(h|d)$/`, so a monitor
 * configured for `"1w"` silently fell through to one hour and measured
 * something nobody asked for. The threshold itself was stored as text and
 * recovered with `parseFloat`.
 *
 * Evaluation here is pure: given the number the engine computed, decide what
 * should happen. Running the query and delivering the notification belong to
 * `apps/worker`.
 *
 * **Two things v2 could not do.** It could enable and disable an existing
 * monitor and nothing else — no create, no update, no delete reached the wire.
 * `create`, `rename`, `retarget`, `reconfigure` are all here now, and deletion
 * is `MonitorRepository.delete`, driven by a use case.
 *
 * The analysis is opaque (`A`). "This analysis must produce a single number" is
 * a real rule and it is not enforceable here — answering it means reading the
 * Analysis IR, which lives in another context's domain. It runs in
 * `@counted/dashboarding-app` through an injected check, and returns the
 * `AnalysisMustBeScalar` / `InvalidAnalysis` kinds this context declares.
 */

import { assertNever, Duration, err, Instant, ok } from "@counted/kernel";
import type { MonitorId, ProjectId, Result, WorkspaceId } from "@counted/kernel";
import { Threshold } from "./threshold";
import type { MonitorError } from "./errors";
import type { MonitorEvent } from "./events";

/** Where a firing monitor is announced. */
export type Channel =
  | { readonly kind: "email"; readonly address: string }
  | { readonly kind: "webhook"; readonly url: string };

/** Whether the monitor was in breach at its last evaluation. */
export type MonitorState = "ok" | "breaching";

/**
 * How long a monitor stays quiet while it is still in breach. Configurable
 * because "tell me every hour" and "tell me every five minutes" are different
 * products; v1 hardcoded an hour.
 */
export const DEFAULT_COOLDOWN = Duration.hours(1);

export type MonitorSnapshot<A> = {
  readonly id: MonitorId;
  /** Carried, not derived through the project, so a monitor's placement for an
   *  authorization decision is readable without a join. */
  readonly workspace: WorkspaceId;
  readonly project: ProjectId;
  readonly name: string;
  readonly analysis: A;
  readonly threshold: Threshold;
  readonly cooldown: Duration;
  readonly channels: readonly Channel[];
  readonly enabled: boolean;
  readonly state: MonitorState;
  readonly lastNotifiedAt: Instant | null;
  readonly lastValue: number | null;
  readonly lastAttemptAt: Instant | null;
  readonly lastMeasuredAt: Instant | null;
  readonly evaluationError: string | null;
  readonly pendingDeliveries: number;
  readonly failedDeliveries: number;
  readonly deliveryError: string | null;
  readonly lastDeliveredAt: Instant | null;
  /** Worker lease token; absent from ordinary reads and the public API. */
  readonly evaluationClaim?: Instant;
};

/**
 * What an evaluation concluded. `silent` carries its reason, so an operator
 * asking "why didn't this fire?" gets an answer instead of a shrug.
 */
export type MonitorDecision =
  | {
      readonly kind: "fire";
      readonly observed: number;
      readonly threshold: Threshold;
      readonly entering: boolean;
    }
  | { readonly kind: "recover"; readonly observed: number }
  | {
      readonly kind: "silent";
      readonly reason: "disabled" | "within-threshold" | "cooling-down";
      readonly observed: number;
    };

export type MonitorApplied<A> = {
  readonly monitor: Monitor<A>;
  readonly events: readonly MonitorEvent[];
};

type MonitorResult<A> = Result<MonitorApplied<A>, MonitorError>;

export type MonitorSettings = {
  readonly cooldown?: Duration;
  readonly channels?: readonly Channel[];
};

export class Monitor<A> {
  private constructor(private readonly s: MonitorSnapshot<A>) {}

  static create<A>(
    id: MonitorId,
    workspace: WorkspaceId,
    project: ProjectId,
    name: string,
    analysis: A,
    threshold: Threshold,
    at: Instant,
    settings: MonitorSettings = {},
  ): MonitorResult<A> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });

    const cooldown = settings.cooldown ?? DEFAULT_COOLDOWN;
    if (Duration.isNegative(cooldown)) return err({ kind: "NegativeCooldown" });

    return ok({
      monitor: new Monitor<A>({
        id,
        workspace,
        project,
        name: trimmed,
        analysis,
        threshold,
        cooldown,
        channels: settings.channels ?? [],
        enabled: true,
        state: "ok",
        lastNotifiedAt: null,
        lastValue: null,
        lastAttemptAt: null,
        lastMeasuredAt: null,
        evaluationError: null,
        pendingDeliveries: 0,
        failedDeliveries: 0,
        deliveryError: null,
        lastDeliveredAt: null,
      }),
      events: [
        { kind: "MonitorCreated", monitor: id, workspace, project, name: trimmed, at },
      ],
    });
  }

  static rehydrate<A>(s: Omit<MonitorSnapshot<A>, "lastAttemptAt" | "lastMeasuredAt" | "evaluationError" | "pendingDeliveries" | "failedDeliveries" | "lastDeliveredAt" | "deliveryError"> & Partial<Pick<MonitorSnapshot<A>, "lastAttemptAt" | "lastMeasuredAt" | "evaluationError" | "pendingDeliveries" | "failedDeliveries" | "lastDeliveredAt" | "deliveryError">>): Monitor<A> {
    return new Monitor<A>({ lastAttemptAt: null, lastMeasuredAt: null, evaluationError: null,
      pendingDeliveries: 0, failedDeliveries: 0, deliveryError: null, lastDeliveredAt: null, ...s });
  }

  snapshot(): MonitorSnapshot<A> {
    return this.s;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get id(): MonitorId {
    return this.s.id;
  }
  get workspace(): WorkspaceId {
    return this.s.workspace;
  }
  get project(): ProjectId {
    return this.s.project;
  }
  get name(): string {
    return this.s.name;
  }
  get analysis(): A {
    return this.s.analysis;
  }
  get threshold(): Threshold {
    return this.s.threshold;
  }
  get cooldown(): Duration {
    return this.s.cooldown;
  }
  get channels(): readonly Channel[] {
    return this.s.channels;
  }
  get enabled(): boolean {
    return this.s.enabled;
  }
  get state(): MonitorState {
    return this.s.state;
  }
  get lastValue(): number | null {
    return this.s.lastValue;
  }
  get lastNotifiedAt(): Instant | null {
    return this.s.lastNotifiedAt;
  }

  get lastAttemptAt(): Instant | null { return this.s.lastAttemptAt; }
  get lastMeasuredAt(): Instant | null { return this.s.lastMeasuredAt; }
  get evaluationError(): string | null { return this.s.evaluationError; }
  get pendingDeliveries(): number { return this.s.pendingDeliveries; }
  get failedDeliveries(): number { return this.s.failedDeliveries; }
  get deliveryError(): string | null { return this.s.deliveryError; }
  get lastDeliveredAt(): Instant | null { return this.s.lastDeliveredAt; }

  /** Record a failed/no-data attempt without treating it as a numeric observation. */
  measurementUnavailable(detail: string, at: Instant): Monitor<A> {
    return this.patch({ lastAttemptAt: at, evaluationError: detail });
  }

  // ── evaluation ───────────────────────────────────────────────────────────

  /**
   * Decide what this observation means. Pure: no notification is sent, no clock
   * is read, nothing is mutated. `decide` then `apply` is two steps because the
   * worker must be able to ask "what would happen?" without it happening.
   *
   * A monitor fires when it enters breach, and again only once the cooldown has
   * elapsed while it stays in breach. It recovers when the value returns inside
   * the threshold — v1 had no notion of recovery at all, so an operator learned
   * that things were bad and never learned they were fine again.
   */
  decide(observed: number, now: Instant): MonitorDecision {
    if (!this.s.enabled) return { kind: "silent", reason: "disabled", observed };

    const breached = Threshold.isBreached(this.s.threshold, observed);

    if (!breached) {
      return this.s.state === "breaching"
        ? { kind: "recover", observed }
        : { kind: "silent", reason: "within-threshold", observed };
    }

    if (this.s.state === "ok") {
      return { kind: "fire", observed, threshold: this.s.threshold, entering: true };
    }

    const since = this.s.lastNotifiedAt;
    if (since !== null) {
      const elapsed = Instant.between(since, now);
      if (Duration.compare(elapsed, this.s.cooldown) < 0) {
        return { kind: "silent", reason: "cooling-down", observed };
      }
    }
    return { kind: "fire", observed, threshold: this.s.threshold, entering: false };
  }

  /** Record the outcome of a decision. */
  apply(decision: MonitorDecision, now: Instant): MonitorApplied<A> {
    const measured = { lastAttemptAt: now, lastMeasuredAt: now, evaluationError: null };
    switch (decision.kind) {
      case "fire":
        return {
          monitor: this.patch({
            ...measured,
            state: "breaching",
            lastNotifiedAt: now,
            lastValue: decision.observed,
          }),
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
          monitor: this.patch({ ...measured, state: "ok", lastValue: decision.observed }),
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
        // Still worth recording: "it ran, and the number was 7" is what an
        // operator needs to distinguish a healthy monitor from a stalled one.
        return { monitor: this.patch({ ...measured, lastValue: decision.observed }), events: [] };
      default:
        return assertNever(decision);
    }
  }

  // ── commands ─────────────────────────────────────────────────────────────

  rename(name: string, at: Instant): MonitorResult<A> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err({ kind: "NameRequired" });
    if (trimmed === this.s.name) return err({ kind: "NameUnchanged" });
    return ok({
      monitor: this.patch({ name: trimmed }),
      events: [{ kind: "MonitorRenamed", monitor: this.s.id, name: trimmed, at }],
    });
  }

  /**
   * Change what is measured, or what counts as bad.
   *
   * Always resets breach state, even when the new question happens to equal the
   * old one: the recorded state described a different question, and carrying it
   * over is how an operator gets told "recovered" about something that was
   * never measured.
   */
  retarget(analysis: A, threshold: Threshold, at: Instant): MonitorResult<A> {
    return ok({
      monitor: this.patch({
        analysis,
        threshold,
        state: "ok",
        lastNotifiedAt: null,
        lastValue: null,
        lastAttemptAt: null,
        lastMeasuredAt: null,
        evaluationError: null,
      }),
      events: [{ kind: "MonitorRetargeted", monitor: this.s.id, at }],
    });
  }

  /**
   * Change how it is announced. Not `retarget`, because none of this changes
   * what is measured, so breach state survives — muting a channel should not
   * make a monitor re-announce a breach it already announced.
   */
  reconfigure(settings: MonitorSettings, at: Instant): MonitorResult<A> {
    const cooldown = settings.cooldown ?? this.s.cooldown;
    if (Duration.isNegative(cooldown)) return err({ kind: "NegativeCooldown" });

    return ok({
      monitor: this.patch({ cooldown, channels: settings.channels ?? this.s.channels }),
      events: [{ kind: "MonitorReconfigured", monitor: this.s.id, at }],
    });
  }

  enable(at: Instant): MonitorResult<A> {
    if (this.s.enabled) return err({ kind: "AlreadyEnabled" });
    return ok({
      monitor: this.patch({ enabled: true, lastNotifiedAt: null, lastValue: null, lastAttemptAt: null, lastMeasuredAt: null, evaluationError: null }),
      events: [{ kind: "MonitorEnabled", monitor: this.s.id, at }],
    });
  }

  /**
   * Disabling also clears breach state, so re-enabling does not re-announce
   * stale news. If the condition is still true when it comes back, it fires as
   * a fresh entry — which is the honest thing to tell an operator who has been
   * looking away.
   */
  disable(at: Instant): MonitorResult<A> {
    if (!this.s.enabled) return err({ kind: "AlreadyDisabled" });
    return ok({
      monitor: this.patch({ enabled: false, state: "ok" }),
      events: [{ kind: "MonitorDisabled", monitor: this.s.id, at }],
    });
  }

  private patch(fields: Partial<MonitorSnapshot<A>>): Monitor<A> {
    return new Monitor<A>({ ...this.s, ...fields });
  }
}
