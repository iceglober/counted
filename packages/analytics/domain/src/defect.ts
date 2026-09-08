/**
 * Structural defects — the ways a question can be malformed.
 *
 * These are separate from `AnalysisError` on purpose, and the split is forced
 * by V3-SPEC §6: the wire contract maps exactly four analytics error kinds, and
 * `InvalidAnalysis` carries a single `detail` string. Collapsing every
 * structural problem into that string at the point it is *found* would throw
 * away everything a console needs to point at the wrong field, so the
 * structured form is kept here and flattened once, at the boundary.
 *
 * It also lets validation report *every* defect rather than the first. v1
 * refused one problem at a time, which turns configuring a tile into a
 * conversation.
 */

export type AnalysisDefect =
  | { readonly kind: "InvalidGrouping"; readonly detail: string }
  | { readonly kind: "EmptyEventName" }
  | { readonly kind: "EmptyPropertyKey" }
  | { readonly kind: "EmptyMeasureName" }
  | { readonly kind: "EmptyPredicateGroup"; readonly op: "and" | "or" }
  | { readonly kind: "EmptyValueList"; readonly op: "in" | "notIn" }
  | {
      readonly kind: "LimitOutOfRange";
      readonly limit: number;
      readonly max: number;
    }
  | { readonly kind: "NonPositiveWindow"; readonly amount: number }
  | { readonly kind: "InvertedWindow" }
  | {
      readonly kind: "TooFewSteps";
      readonly count: number;
      readonly min: number;
    }
  | {
      readonly kind: "TooManySteps";
      readonly count: number;
      readonly max: number;
    }
  | { readonly kind: "StepWithoutEvents"; readonly index: number }
  | { readonly kind: "NonPositiveConversionWindow" };

export const describeDefect = (d: AnalysisDefect): string => {
  switch (d.kind) {
    case "InvalidGrouping":
      return d.detail;
    case "EmptyEventName":
      return "an event name is blank";
    case "EmptyPropertyKey":
      return "a property name is blank";
    case "EmptyMeasureName":
      return "the measure to sum is unnamed";
    case "EmptyPredicateGroup":
      return `an \`${d.op}\` has no operands`;
    case "EmptyValueList":
      return `an \`${d.op}\` has no values`;
    case "LimitOutOfRange":
      return `limit ${d.limit} is outside 1..${d.max}`;
    case "NonPositiveWindow":
      return `a window of ${d.amount} covers no time`;
    case "InvertedWindow":
      return "the window ends before it starts";
    case "TooFewSteps":
      return `a funnel needs at least ${d.min} steps, this one has ${d.count}`;
    case "TooManySteps":
      return `a funnel takes at most ${d.max} steps, this one has ${d.count}`;
    case "StepWithoutEvents":
      return `step ${d.index + 1} names no events`;
    case "NonPositiveConversionWindow":
      return "the conversion window gives nobody any time to convert";
  }
};

/** Flatten defects into the one string the wire contract carries. */
export const describeDefects = (defects: readonly AnalysisDefect[]): string =>
  defects.map(describeDefect).join("; ");
