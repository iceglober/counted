/**
 * Funnels — ordered, time-bounded step conversion.
 *
 * v1's funnel was not a funnel. Each step added an `AND session_id IN (SELECT
 * session_id FROM events WHERE event_name = $n)` conjunct, so it counted
 * visits that contained *all* the named events in **any order**, with no
 * deadline between them. A visit that fired `purchase` on Monday and
 * `view_product` on Friday counted as fully converted, and the doc-comment
 * directly above the SQL claimed "performed each step in sequence". It also
 * took `steps: string[]` and therefore silently discarded any property filters
 * the insight had configured.
 *
 * Three things are fixed here, all in the type:
 *   1. Steps are ordered — step i must occur strictly after step i-1.
 *   2. A conversion window bounds first step to last.
 *   3. A step carries a predicate, so "purchase where amount > 100" is a step.
 *
 * The counting itself belongs to the store. What lives here is the definition
 * and the arithmetic over the counts it returns.
 */

import { assertNever } from "../shared/brand";
import { Duration } from "../shared/duration";
import { err, ok, type Result } from "../shared/result";
import type { CountingBasis } from "../identity/subject";
import type { Predicate } from "./predicate";
import type { Window } from "./window";

export type FunnelStep = {
  /** Shown to humans. Falls back to the event names when absent. */
  readonly label?: string;
  /** The step is reached by any one of these events. Must be non-empty. */
  readonly events: readonly string[];
  /** Narrows what counts as this step. v1 dropped these entirely. */
  readonly where?: Predicate;
};

export const FunnelStep = {
  of: (events: readonly string[], where?: Predicate, label?: string): FunnelStep => ({
    events,
    ...(where === undefined ? {} : { where }),
    ...(label === undefined ? {} : { label }),
  }),

  label: (s: FunnelStep, index: number): string =>
    s.label ?? (s.events.length > 0 ? s.events.join(" or ") : `Step ${index + 1}`),
} as const;

export type Funnel = {
  readonly steps: readonly FunnelStep[];
  /** The period whose starts are counted. */
  readonly window: Window;
  /**
   * How long a subject has to get from the first step to the last. Without
   * this a funnel is just a set-membership question, which is exactly what v1
   * was computing.
   */
  readonly conversionWindow: Duration;
  /**
   * `visit` keeps the whole journey inside one visit — the honest default,
   * since a visit ends after 30 minutes idle. `person` lets the journey span
   * visits, and is only answerable on identified events.
   */
  readonly basis: CountingBasis;
};

export type FunnelError =
  | { kind: "TooFewSteps"; count: number }
  | { kind: "TooManySteps"; count: number; max: number }
  | { kind: "StepWithoutEvents"; index: number }
  | { kind: "EmptyEventName"; index: number }
  | { kind: "NonPositiveConversionWindow" };

export const MAX_FUNNEL_STEPS = 10;

/** One step's outcome, once the store has counted. */
export type FunnelStepResult = {
  readonly label: string;
  /** Subjects that reached this step within the rules. */
  readonly reached: number;
  /** Percentage of the previous step that got here. Step 0 is always 100. */
  readonly rate: number;
  /** Percentage of the first step that got here. */
  readonly cumulativeRate: number;
  /** Subjects lost between the previous step and this one. */
  readonly droppedOff: number;
};

export type FunnelResult = {
  readonly steps: readonly FunnelStepResult[];
  /** Percentage of first-step subjects that completed every step. */
  readonly overallRate: number;
};

export type FunnelSummaryError = {
  kind: "CountMismatch" | "NonMonotonicCounts";
  detail: string;
};

export const Funnel = {
  of: (
    steps: readonly FunnelStep[],
    window: Window,
    conversionWindow: Duration,
    basis: CountingBasis = "visit",
  ): Funnel => ({ steps, window, conversionWindow, basis }),

  /** True when the funnel is allowed to span visits. */
  spansVisits: (f: Funnel): boolean => f.basis === "person",

  labels: (f: Funnel): readonly string[] => f.steps.map((s, i) => FunnelStep.label(s, i)),

  /** Every event name the funnel mentions, deduplicated. */
  eventNames: (f: Funnel): readonly string[] => [
    ...new Set(f.steps.flatMap((s) => s.events)),
  ],

  validate: (f: Funnel): Result<Funnel, FunnelError> => {
    if (f.steps.length < 2) return err({ kind: "TooFewSteps", count: f.steps.length });
    if (f.steps.length > MAX_FUNNEL_STEPS) {
      return err({ kind: "TooManySteps", count: f.steps.length, max: MAX_FUNNEL_STEPS });
    }
    for (const [index, step] of f.steps.entries()) {
      if (step.events.length === 0) return err({ kind: "StepWithoutEvents", index });
      for (const name of step.events) {
        if (name.trim().length === 0) return err({ kind: "EmptyEventName", index });
      }
    }
    if (Duration.toMillis(f.conversionWindow) <= 0) {
      return err({ kind: "NonPositiveConversionWindow" });
    }
    return ok(f);
  },

  /**
   * Turn per-step counts into rates.
   *
   * Counts must be non-increasing: each step is a subset of the one before it,
   * so a rise means the store answered a different question than was asked.
   * v1 could not detect this because its conjunctive query made monotonicity
   * accidental rather than checked — and it divided without guarding, so an
   * empty first step produced NaN rates that rendered as "NaN%".
   */
  summarize: (
    f: Funnel,
    counts: readonly number[],
  ): Result<FunnelResult, FunnelSummaryError> => {
    if (counts.length !== f.steps.length) {
      return err({
        kind: "CountMismatch",
        detail: `${counts.length} counts for ${f.steps.length} steps`,
      });
    }

    for (let i = 1; i < counts.length; i++) {
      const prev = counts[i - 1] ?? 0;
      const here = counts[i] ?? 0;
      if (here > prev) {
        return err({
          kind: "NonMonotonicCounts",
          detail: `step ${i} (${here}) exceeds step ${i - 1} (${prev})`,
        });
      }
    }

    const first = counts[0] ?? 0;
    const steps = counts.map((reached, i): FunnelStepResult => {
      const prev = i === 0 ? reached : (counts[i - 1] ?? 0);
      return {
        label: FunnelStep.label(f.steps[i]!, i),
        reached,
        rate: i === 0 ? 100 : percent(reached, prev),
        cumulativeRate: percent(reached, first),
        droppedOff: i === 0 ? 0 : Math.max(0, prev - reached),
      };
    });

    return ok({
      steps,
      overallRate: percent(counts[counts.length - 1] ?? 0, first),
    });
  },

  /**
   * Where the funnel leaks worst, by absolute loss. Returns null for a funnel
   * that loses nobody.
   */
  biggestDropOff: (r: FunnelResult): FunnelStepResult | null => {
    let worst: FunnelStepResult | null = null;
    for (const s of r.steps) {
      if (s.droppedOff > 0 && (worst === null || s.droppedOff > worst.droppedOff)) worst = s;
    }
    return worst;
  },

  basisLabel: (f: Funnel): string => {
    switch (f.basis) {
      case "visit":
        return "visits";
      case "person":
        return "people";
      default:
        return assertNever(f.basis);
    }
  },
} as const;

/** Zero denominators give zero, never NaN or Infinity. */
const percent = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100);
