/**
 * Answerability — how, and how expensively, an engine can serve a question.
 *
 * This is the module the plan singles out as a real design constraint rather
 * than an implementation detail. Pre-aggregation is what makes a read fast at
 * any depth of history, and the index answers filters over the declared dimensions
 * only, with event-name sets supported alongside dimension equality.
 * Every predicate the product offers beyond that shape is a raw scan of the
 * event partitions — which is a *product* decision about cost, taken
 * deliberately, not a missing engine feature.
 *
 * So the classification is exported, and it is exported from the domain rather
 * than hidden in the adapter, because three different callers need it:
 *
 *   - the litics adapter, which needs the flat filter map or must take the
 *     slow path knowingly;
 *   - a future cost control, which has to refuse or meter scans before they
 *     run rather than after they time out;
 *   - the console, which can tell someone *why* their filter is slow.
 *
 * The three outcomes are ordered by severity. `unanswerable` beats `scan`
 * beats `indexed`: a question that touches `country` cannot be rescued by also
 * being simple, and one blocked leaf blocks the whole predicate.
 */

import { assertNever } from "@counted/kernel";
import { DimensionCatalog, EVENT_TYPE } from "./dimension";
import { FieldRef } from "./field";
import { Predicate, type PredicateOp } from "./predicate";

/**
 * The flat, index-native form of a predicate.
 *
 * `event` is separated from `filters` because the engine separates them: a
 * series query names one event type or a set and carries dimension equality for the
 * rest. Splitting it here means the adapter does no re-inspection.
 */
export type IndexedPlan = {
  readonly event?: string | readonly string[];
  readonly filters: Readonly<Record<string, string>>;
};

/** Why a predicate cannot be served from the index, stated per cause. */
export type ScanReason =
  | { readonly kind: "UnsupportedOperator"; readonly op: PredicateOp }
  | { readonly kind: "Disjunction" }
  | { readonly kind: "Negation" }
  | { readonly kind: "UndeclaredDimension"; readonly key: string }
  | { readonly kind: "ShadowedDimension"; readonly key: string }
  | { readonly kind: "RepeatedDimension"; readonly key: string }
  | { readonly kind: "NonStringValue"; readonly key: string };

/**
 * Why a question cannot be answered at all today.
 *
 * Distinct from a scan reason on purpose. A scan is slow; a blocker means the
 * data does not exist, so there is no query — fast or slow — that produces an
 * answer. Rendering the second as an empty chart is the failure this package
 * is built to prevent.
 */
export type Blocker =
  | { readonly kind: "DimensionNotCollected"; readonly key: string }
  | { readonly kind: "StepCountUnsupported"; readonly count: number; readonly supported: number }
  | { readonly kind: "StepPredicateUnsupported"; readonly index: number }
  | { readonly kind: "MultiEventStepUnsupported"; readonly index: number };

export type Answerability =
  | {
      readonly kind: "indexed";
      readonly plan: IndexedPlan;
      /**
       * How many engine calls this costs.
       *
       * One, for everything the engine can serve today — a breakdown included,
       * since litics grew a group-by. Kept as a number rather than dropped
       * because it is what a cost control meters, and the next question that
       * needs a fan-out (a comparison against a prior period, say) should have
       * somewhere to say so.
       */
      readonly queries: number;
    }
  | { readonly kind: "scan"; readonly reasons: readonly ScanReason[] }
  | { readonly kind: "unanswerable"; readonly reasons: readonly Blocker[] };

export const Answerability = {
  isIndexed: (a: Answerability): boolean => a.kind === "indexed",
  isCheap: (a: Answerability): boolean => a.kind === "indexed" && a.queries === 1,

  /** Ordering used to combine parts of one question: worst wins. */
  severity: (a: Answerability): number => {
    switch (a.kind) {
      case "indexed":
        return 0;
      case "scan":
        return 1;
      case "unanswerable":
        return 2;
      default:
        return assertNever(a);
    }
  },

  describe: (a: Answerability): string => {
    switch (a.kind) {
      case "indexed":
        return a.queries === 1
          ? "answered from indexed dimensions"
          : `answered from indexed dimensions, ${a.queries} queries`;
      case "scan":
        return `raw scan: ${a.reasons.map(describeScanReason).join("; ")}`;
      case "unanswerable":
        return `not available: ${a.reasons.map(describeBlocker).join("; ")}`;
      default:
        return assertNever(a);
    }
  },
} as const;

export const describeScanReason = (r: ScanReason): string => {
  switch (r.kind) {
    case "UnsupportedOperator":
      return `\`${r.op}\` is not an indexed filter`;
    case "Disjunction":
      return "an `or` cannot be expressed as dimension equality";
    case "Negation":
      return "a negation cannot be expressed as dimension equality";
    case "UndeclaredDimension":
      return `\`${r.key}\` is not a declared dimension`;
    case "ShadowedDimension":
      return `the property \`${r.key}\` shares a name with a Counted dimension`;
    case "RepeatedDimension":
      return `\`${r.key}\` is constrained twice`;
    case "NonStringValue":
      return `\`${r.key}\` is compared to a non-string value`;
    default:
      return assertNever(r);
  }
};

export const describeBlocker = (b: Blocker): string => {
  switch (b.kind) {
    case "DimensionNotCollected":
      return `\`${b.key}\` is not collected yet`;
    case "StepCountUnsupported":
      return `the engine funnels exactly ${b.supported} steps, this one has ${b.count}`;
    case "StepPredicateUnsupported":
      return `step ${b.index + 1} carries a filter the engine cannot apply per step`;
    case "MultiEventStepUnsupported":
      return `step ${b.index + 1} accepts more than one event`;
    default:
      return assertNever(b);
  }
};

/**
 * Classify a predicate against a project's declared dimensions.
 *
 * Index-answerable means, exactly: a conjunction of `eq` leaves, each on a
 * distinct indexed dimension, each compared to a string. Everything else is
 * named, not merely rejected — the caller gets every reason at once so a
 * console can list all of them rather than one per round trip.
 */
export const classifyPredicate = (
  predicate: Predicate | undefined,
  catalog: DimensionCatalog,
): Answerability => {
  if (predicate === undefined) return { kind: "indexed", plan: { filters: {} }, queries: 1 };

  const blockers: Blocker[] = [];
  const reasons: ScanReason[] = [];
  const filters: Record<string, string> = {};
  let event: string | readonly string[] | undefined;

  for (const leaf of Predicate.conjuncts(predicate)) {
    if (leaf.op === "or") {
      reasons.push({ kind: "Disjunction" });
      collectBlockers(leaf, catalog, blockers);
      continue;
    }
    if (leaf.op === "not") {
      reasons.push({ kind: "Negation" });
      collectBlockers(leaf, catalog, blockers);
      continue;
    }

    const key = leaf.field.key;
    const status = DimensionCatalog.status(catalog, key);
    if (status === "planned") {
      blockers.push({ kind: "DimensionNotCollected", key });
      continue;
    }

    // Event unions use indexed summary rows and merge actor sets before
    // counting. Other set predicates remain outside this capability.
    if (leaf.op === "in" && key === EVENT_TYPE && leaf.field.source === "dimension") {
      if (leaf.values.length === 0 || !leaf.values.every((value): value is string => typeof value === "string")) {
        reasons.push({ kind: "NonStringValue", key });
      } else if (event !== undefined) {
        reasons.push({ kind: "RepeatedDimension", key });
      } else {
        event = [...new Set(leaf.values)];
      }
      continue;
    }

    if (leaf.op !== "eq") {
      reasons.push({ kind: "UnsupportedOperator", op: leaf.op });
      continue;
    }
    if (FieldRef.isShadowed(leaf.field)) {
      reasons.push({ kind: "ShadowedDimension", key });
      continue;
    }
    if (status === "unknown" || status === "scanned") {
      reasons.push({ kind: "UndeclaredDimension", key });
      continue;
    }
    if (typeof leaf.value !== "string") {
      reasons.push({ kind: "NonStringValue", key });
      continue;
    }
    if (key === EVENT_TYPE) {
      if (event !== undefined) {
        reasons.push({ kind: "RepeatedDimension", key });
        continue;
      }
      event = leaf.value;
      continue;
    }
    if (Object.hasOwn(filters, key)) {
      reasons.push({ kind: "RepeatedDimension", key });
      continue;
    }
    filters[key] = leaf.value;
  }

  if (blockers.length > 0) return { kind: "unanswerable", reasons: blockers };
  if (reasons.length > 0) return { kind: "scan", reasons };
  return {
    kind: "indexed",
    plan: event === undefined ? { filters } : { event, filters },
    queries: 1,
  };
};

/**
 * A blocked dimension inside an `or` or a `not` still blocks the question. The
 * branch is a scan either way, but a scan over a column nothing writes returns
 * nothing — so the blocker has to survive the branch.
 */
const collectBlockers = (p: Predicate, catalog: DimensionCatalog, into: Blocker[]): void => {
  for (const f of Predicate.fields(p)) {
    if (DimensionCatalog.status(catalog, f.key) === "planned") {
      into.push({ kind: "DimensionNotCollected", key: f.key });
    }
  }
};

/** Combine the parts of one question. Worst outcome wins, reasons accumulate. */
export const worst = (parts: readonly Answerability[]): Answerability => {
  const blockers = parts.flatMap((p) => (p.kind === "unanswerable" ? p.reasons : []));
  if (blockers.length > 0) return { kind: "unanswerable", reasons: dedupe(blockers) };

  const scans = parts.flatMap((p) => (p.kind === "scan" ? p.reasons : []));
  if (scans.length > 0) return { kind: "scan", reasons: dedupe(scans) };

  const indexed = parts.filter((p): p is Extract<Answerability, { kind: "indexed" }> => p.kind === "indexed");
  const filters: Record<string, string> = {};
  let event: string | readonly string[] | undefined;
  let queries = 1;
  for (const c of indexed) {
    Object.assign(filters, c.plan.filters);
    if (c.plan.event !== undefined) event = c.plan.event;
    queries = Math.max(queries, c.queries);
  }
  return {
    kind: "indexed",
    plan: event === undefined ? { filters } : { event, filters },
    queries,
  };
};

const dedupe = <T>(items: readonly T[]): readonly T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};
