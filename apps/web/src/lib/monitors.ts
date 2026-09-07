/**
 * The monitor form's one job: turn a handful of fields into what
 * `monitors.create` accepts — a scalar analysis, a threshold, a cooldown and a
 * list of channels — and refuse, in words, the combinations that cannot be one.
 *
 * Only a scalar is monitorable, and this form cannot post anything else: it
 * never offers a shape. The API's `AnalysisMustBeScalar` refusal is for callers
 * that compose their own analysis; from here it is unreachable.
 *
 * Every type is projected out of the contract. `Monitor`, `Threshold` and
 * `Channel` are the wire's own names, and they are aliases of what the list
 * route returns rather than restatements of it — `no-hand-written-shapes`
 * checks exactly that.
 */

import type { ContractOutputs } from "@counted/contract";
import { draftFor, eventsPredicate, measureFor, oneOf, WINDOW_UNITS, type Predicate } from "./analysis";
import { count, day } from "./format";

export type Monitor = ContractOutputs["monitors"]["list"]["items"][number];
export type Threshold = Monitor["threshold"];
export type Channel = Monitor["channels"][number];
type Analysis = Monitor["analysis"];
type ScalarAnalysis = Extract<Analysis, { shape: "scalar" }>;
type Summary = ScalarAnalysis["summary"];
type Comparison = Threshold["comparison"];

/**
 * How the window collapses to the one number the threshold is compared with.
 * `total` is the only one that reads as zero on an empty window; the other
 * four are null there and the monitor stays quiet, because the peak of nothing
 * is not zero.
 */
export const SUMMARIES = [
  { value: "total", label: "Total" },
  { value: "average", label: "Average" },
  { value: "peak", label: "Peak" },
  { value: "low", label: "Lowest" },
  { value: "latest", label: "Latest" },
] as const satisfies readonly { readonly value: Summary; readonly label: string }[];

const SUMMARY_VALUES: readonly Summary[] = SUMMARIES.map((one) => one.value);

/** The same words, lower-cased for the middle of a sentence. */
const SUMMARY_WORDS: Readonly<Record<Summary, string>> = {
  total: "total",
  average: "average",
  peak: "peak",
  low: "lowest",
  latest: "latest",
};

export const COMPARISONS = ["above", "below"] as const satisfies readonly Comparison[];

/**
 * The cooldown is entered as a count of one of these and sent as milliseconds,
 * which is the only duration the wire has (contract `primitives.ts`).
 */
export const COOLDOWN_UNITS = [
  { value: "minute", label: "minutes", ms: 60_000 },
  { value: "hour", label: "hours", ms: 3_600_000 },
  { value: "day", label: "days", ms: 86_400_000 },
] as const;

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

const refuse = (problem: string): { readonly ok: false; readonly problem: string } => ({
  ok: false,
  problem,
});

export type ScalarDraft = {
  readonly measure: string;
  /** Optional event-name restriction. */
  readonly event: string | undefined;
  readonly events?: readonly string[];
  readonly windowAmount: number | null;
  readonly windowUnit: string;
  readonly summary: string;
};

/**
 * The scalar a `number` tile is, with a chosen summary instead of `total`. The
 * window stays relative for the same reason a tile's does: "the last hour" has
 * to still mean that at every evaluation.
 */
export const scalar = (draft: ScalarDraft): Parsed<ScalarAnalysis> => {
  const measure = measureFor(draft.measure);
  if (measure === null) return refuse("Choose what the monitor should measure.");

  const unit = oneOf(WINDOW_UNITS, draft.windowUnit);
  if (unit === null) return refuse("Choose a window unit.");
  if (draft.windowAmount === null || draft.windowAmount < 1) {
    return refuse("A window is a whole number of units, at least one.");
  }

  const summary = oneOf(SUMMARY_VALUES, draft.summary);
  if (summary === null) return refuse("Choose how the window collapses to one number.");

  return {
    ok: true,
    value: {
      shape: "scalar",
      measure,
      window: { kind: "relative", amount: draft.windowAmount, unit },
      summary,
      ...(() => { const where = eventsPredicate(draft.events ?? (draft.event === undefined ? [] : [draft.event])); return where ? { where } : {}; })(),
    },
  };
};

/** Replacing event selection must retain property and nested filters from the existing analysis. */
export const retargetAnalysis = (current: Analysis, draft: ScalarDraft): Parsed<ScalarAnalysis> => {
  if (current.shape !== "scalar") return refuse("This monitor must measure a single number.");
  const changed = scalar(draft);
  if (!changed.ok) return changed;
  const kept = draftFor(current, "number").where;
  const filters = [changed.value.where, kept].filter((one): one is Predicate => one !== undefined);
  return { ok: true, value: { ...changed.value,
    ...(filters.length ? { where: filters.length === 1 ? filters[0]! : { op: "and", operands: filters } } : {}),
  } };
};

export const threshold = (comparison: string, value: number | null): Parsed<Threshold> => {
  const which = oneOf(COMPARISONS, comparison);
  if (which === null) return refuse("Choose whether the monitor fires above or below the value.");
  if (value === null) return refuse("A threshold is a number.");
  return { ok: true, value: { comparison: which, value } };
};

/**
 * Blank is "not stated" rather than zero: the domain's default on create, and
 * unchanged on update. Zero is a real cooldown — announce every evaluation —
 * and has to be typed to be meant.
 */
export const cooldown = (amount: number | null, unit: string): Parsed<number | undefined> => {
  if (amount === null) return { ok: true, value: undefined };
  if (!Number.isInteger(amount) || amount < 0) {
    return refuse("A cooldown is a whole number of units, zero or more.");
  }
  const which = COOLDOWN_UNITS.find((one) => one.value === unit);
  if (which === undefined) return refuse("Choose a cooldown unit.");
  return { ok: true, value: amount * which.ms };
};

/**
 * One channel per line. A line with an `@` is an email address; an `http(s)://`
 * line is a webhook; anything else is refused by line so the reader can find
 * it. The API validates the address and the URL properly — this only decides
 * which kind each line is asking for.
 */
export const channels = (raw: string): Parsed<Channel[]> => {
  const parsed: Channel[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const entry = line.trim();
    if (entry === "") continue;
    if (/^https?:\/\//i.test(entry)) parsed.push({ kind: "webhook", url: entry });
    else if (/^[^@\s]+@[^@\s]+$/.test(entry)) parsed.push({ kind: "email", address: entry });
    else return refuse(`“${entry}” is neither an email address nor an http(s) URL.`);
  }
  return { ok: true, value: parsed };
};

export type DeliveryDraft = {
  readonly cooldownAmount: number | null;
  readonly cooldownUnit: string;
  readonly channels: string;
};

/** The part of a monitor that changes without resetting its breach state. */
export type Delivery = {
  readonly channels: Channel[];
  readonly cooldownMs?: number;
};

export const delivery = (draft: DeliveryDraft): Parsed<Delivery> => {
  const quiet = cooldown(draft.cooldownAmount, draft.cooldownUnit);
  if (!quiet.ok) return quiet;
  const where = channels(draft.channels);
  if (!where.ok) return where;
  return {
    ok: true,
    value: {
      channels: where.value,
      ...(quiet.value === undefined ? {} : { cooldownMs: quiet.value }),
    },
  };
};

export type MonitorDraft = ScalarDraft &
  DeliveryDraft & {
    readonly comparison: string;
    readonly value: number | null;
  };

export type Composed = Delivery & {
  readonly analysis: ScalarAnalysis;
  readonly threshold: Threshold;
};

/** Everything `monitors.create` needs beyond the project and the name. */
export const compose = (draft: MonitorDraft): Parsed<Composed> => {
  const analysis = scalar(draft);
  if (!analysis.ok) return analysis;
  const limit = threshold(draft.comparison, draft.value);
  if (!limit.ok) return limit;
  const announce = delivery(draft);
  if (!announce.ok) return announce;
  return {
    ok: true,
    value: { analysis: analysis.value, threshold: limit.value, ...announce.value },
  };
};

// ── reading a monitor back, for the list ─────────────────────────────────────

const describeMeasure = (measure: ScalarAnalysis["measure"]): string => {
  switch (measure.kind) {
    case "count":
      return "events";
    case "unique":
      return measure.basis === "visit" ? "unique visits" : "unique people";
    case "sum":
      return `sum of ${measure.name}`;
  }
};

const describeWindow = (interval: ScalarAnalysis["window"]): string =>
  interval.kind === "relative"
    ? `last ${interval.amount} ${interval.unit}${interval.amount === 1 ? "" : "s"}`
    : `${day(interval.from)} to ${day(interval.to)}`;

/** The one filter this console writes, read back. Anything else is "filtered". */
const describeFilter = (where: ScalarAnalysis["where"]): string => {
  if (where === undefined) return "";
  if (
    where.op === "eq" &&
    where.field.source === "dimension" &&
    where.field.key === "event_type" &&
    typeof where.value === "string"
  ) {
    return ` where the event is “${where.value}”`;
  }
  return " with a filter";
};

/**
 * "total events, last 7 days". The three non-scalar shapes are named rather
 * than described: the API refuses them at creation, so one on the wire is a
 * fact worth seeing, not a rendering to smooth over.
 */
export const describeAnalysis = (analysis: Analysis): string => {
  switch (analysis.shape) {
    case "scalar": {
      const what = `${SUMMARY_WORDS[analysis.summary]} ${describeMeasure(analysis.measure)}`;
      return `${what}${describeFilter(analysis.where)}, ${describeWindow(analysis.window)}`;
    }
    case "series":
      return "a series — not one number";
    case "breakdown":
      return "a breakdown — not one number";
    case "funnel":
      return "a funnel — not one number";
  }
};

/**
 * Exact, not rounded: `measured` keeps one decimal, and a threshold of 0.25
 * shown as 0.3 is a page disagreeing with the rule it describes.
 */
export const describeThreshold = (limit: Threshold): string =>
  `${limit.comparison} ${Number.isInteger(limit.value) ? count(limit.value) : String(limit.value)}`;

export const describeChannel = (channel: Channel): string =>
  channel.kind === "email" ? channel.address : channel.url;

/** The inverse of `channels`, for a textarea's default value. */
export const channelLines = (list: readonly Channel[]): string =>
  list.map(describeChannel).join("\n");
