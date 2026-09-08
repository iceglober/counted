/**
 * Funnels — ordered, time-bounded step conversion.
 *
 * v1's funnel was not a funnel. Each step added an `AND session_id IN (SELECT
 * session_id FROM events WHERE event_name = $n)` conjunct, so it counted visits
 * that contained *all* the named events in **any order**, with no deadline
 * between them. A visit that fired `purchase` on Monday and `view_product` on
 * Friday counted as fully converted, and the doc-comment directly above the SQL
 * claimed "performed each step in sequence". It also took `steps: string[]` and
 * therefore silently discarded whatever property filters the insight had
 * configured.
 *
 * Three fixes, all of them in the type rather than in a convention:
 *   1. Steps are ordered — step i must occur strictly after step i-1.
 *   2. A `ConversionWindow` bounds first step to last. It is a distinct type,
 *      so it cannot be confused with the observation window.
 *   3. A step carries a `Predicate`, so "purchase where amount > 100" is a
 *      step and property filters survive.
 *
 * The counting belongs to the engine. What lives here is the definition, the
 * arithmetic over the counts that come back, and an honest statement of which
 * funnels the engine can currently serve — see `Funnel.answerability`.
 */

import { err, ok, type Result } from "@counted/kernel";
import type { Answerability, Blocker } from "./answerability";
import type { AnalysisDefect } from "./defect";
import { CountingBasis } from "./measure";
import { Predicate } from "./predicate";
import { ConversionWindow, type Window } from "./window";

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
  /** The period whose first steps are counted. */
  readonly window: Window;
  /**
   * How long a subject has to get from the first step to the last. Without
   * this a funnel is a set-membership question, which is what v1 computed.
   */
  readonly conversionWindow: ConversionWindow;
  /**
   * `visit` keeps the whole journey inside one visit — the honest default,
   * since a visit ends after 30 minutes idle. `person` lets the journey span
   * visits, and is only answerable on identified events.
   */
  readonly basis: CountingBasis;
};

export const MIN_FUNNEL_STEPS = 2;
export const MAX_FUNNEL_STEPS = 10;

/**
 * How many steps the engine's funnel builder takes. Exactly three — litics'
 * builder is a 3-tuple, not a list. Stated as a constant so the one funnel
 * shape that runs today is named rather than discovered at runtime.
 */
export const ENGINE_FUNNEL_STEPS = 3;

/** One step's outcome, once the engine has counted. */
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

/**
 * The engine answered a different question than the one that was asked.
 *
 * Not an `AnalysisDefect`: the funnel was well-formed, the numbers are not.
 * Distinguishing the two matters because one is the customer's mistake and the
 * other is ours.
 */
export type FunnelSummaryError = {
  readonly kind: "CountMismatch" | "NonMonotonicCounts";
  readonly detail: string;
};

export const Funnel = {
  of: (
    steps: readonly FunnelStep[],
    window: Window,
    conversionWindow: ConversionWindow = ConversionWindow.DEFAULT,
    basis: CountingBasis = "visit",
  ): Funnel => ({ steps, window, conversionWindow, basis }),

  /** True when the funnel is allowed to span visits. */
  spansVisits: (f: Funnel): boolean => CountingBasis.spansVisits(f.basis),

  /** True when it can only be answered on identified events. */
  requiresPerson: (f: Funnel): boolean => f.basis === "person",

  labels: (f: Funnel): readonly string[] => f.steps.map((s, i) => FunnelStep.label(s, i)),

  /** Every event name the funnel mentions, deduplicated, in step order. */
  eventNames: (f: Funnel): readonly string[] => [...new Set(f.steps.flatMap((s) => s.events))],

  basisLabel: (f: Funnel): string => CountingBasis.label(f.basis),

  toKey: (f: Funnel): string =>
    [
      `steps:${f.steps
        .map(
          (s) =>
            `${[...s.events].sort().join("+")}${
              s.where === undefined ? "" : `@${Predicate.toKey(s.where)}`
            }`,
        )
        .join(">")}`,
      ConversionWindow.toKey(f.conversionWindow),
      `basis:${f.basis}`,
    ].join(";"),

  /** Every structural problem, all at once. Empty means well-formed. */
  defects: (f: Funnel): readonly AnalysisDefect[] => {
    const out: AnalysisDefect[] = [];
    if (f.steps.length < MIN_FUNNEL_STEPS) {
      out.push({ kind: "TooFewSteps", count: f.steps.length, min: MIN_FUNNEL_STEPS });
    }
    if (f.steps.length > MAX_FUNNEL_STEPS) {
      out.push({ kind: "TooManySteps", count: f.steps.length, max: MAX_FUNNEL_STEPS });
    }
    for (const [index, step] of f.steps.entries()) {
      if (step.events.length === 0) out.push({ kind: "StepWithoutEvents", index });
      if (step.events.some((name) => name.trim().length === 0)) {
        out.push({ kind: "EmptyEventName" });
      }
    }
    if (!ConversionWindow.isPositive(f.conversionWindow)) {
      out.push({ kind: "NonPositiveConversionWindow" });
    }
    return out;
  },

  /**
   * Which funnels the engine can serve today.
   *
   * Exactly three steps, one bare event name each, no per-step predicate. That
   * is not a shape we chose — it is the builder's signature — and a funnel
   * outside it is `unanswerable` rather than quietly reduced to something the
   * engine will accept. Reducing it is precisely what v1 did when it discarded
   * step filters, and the resulting chart was wrong without saying so.
   */
  answerability: (f: Funnel): Answerability => {
    const blockers: Blocker[] = [];
    if (f.steps.length !== ENGINE_FUNNEL_STEPS) {
      blockers.push({
        kind: "StepCountUnsupported",
        count: f.steps.length,
        supported: ENGINE_FUNNEL_STEPS,
      });
    }
    for (const [index, step] of f.steps.entries()) {
      if (step.where !== undefined) blockers.push({ kind: "StepPredicateUnsupported", index });
      if (step.events.length > 1) blockers.push({ kind: "MultiEventStepUnsupported", index });
    }
    if (blockers.length > 0) return { kind: "unanswerable", reasons: blockers };
    return { kind: "indexed", plan: { filters: {} }, queries: 1 };
  },

  /**
   * Turn per-step counts into rates.
   *
   * Counts must be non-increasing: each step is a subset of the one before it,
   * so a rise means the engine answered a different question than was asked.
   * v1 could not detect this, because its conjunctive query made monotonicity
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
      const step = f.steps[i];
      return {
        label: step === undefined ? `Step ${i + 1}` : FunnelStep.label(step, i),
        reached,
        rate: i === 0 ? 100 : percent(reached, prev),
        cumulativeRate: percent(reached, first),
        droppedOff: i === 0 ? 0 : Math.max(0, prev - reached),
      };
    });

    return ok({ steps, overallRate: percent(counts[counts.length - 1] ?? 0, first) });
  },

  /**
   * Where the funnel leaks worst, by absolute loss. `null` for a funnel that
   * loses nobody.
   */
  biggestDropOff: (r: FunnelResult): FunnelStepResult | null => {
    let worstStep: FunnelStepResult | null = null;
    for (const s of r.steps) {
      if (s.droppedOff > 0 && (worstStep === null || s.droppedOff > worstStep.droppedOff)) {
        worstStep = s;
      }
    }
    return worstStep;
  },
} as const;

/** Zero denominators give zero, never NaN or Infinity. */
const percent = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100);
