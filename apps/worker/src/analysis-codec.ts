/**
 * Reading a stored Analysis back out of a jsonb column.
 *
 * `AnalysisCodec` exists because `@counted/adapter-postgres` is below the layer
 * that closes the analysis type parameter, so it stores an opaque value and
 * asks the composition root how to read one. Its own
 * `unvalidatedAnalysisCodec` casts, which its doc comment correctly calls wrong
 * in production: the worker is the one process that takes a stored analysis and
 * *runs it against a database*, so a row written by an older version — or by
 * hand — reaching the engine as `switch (measure.kind)` with a kind nobody
 * anticipated is a crash in a background loop nobody is watching.
 *
 * **The stored form is the domain form, not the wire form.** An `Instant` is a
 * branded number, so an absolute window round-trips through JSON as two epoch
 * millis and needs no conversion; `@counted/contract`'s `AnalysisSchema` spells
 * those two fields as ISO-8601 strings because that is what belongs on an HTTP
 * boundary. Both are correct for their own layer and they are not the same
 * bytes. Flagged in the hand-off, because `apps/api` writes the rows this
 * reads and the two roots have to agree.
 *
 * Everything here refuses by returning `null` rather than by throwing, and the
 * one throw is in `decode` — which is the interface the adapter specified, and
 * which the monitor sweep catches per monitor so one unreadable row does not
 * stop the other two hundred.
 */

import {
  ConversionWindow,
  FieldRef,
  isDimensionName,
  MAX_BREAKDOWN_LIMIT,
  type Analysis,
  type CountingBasis,
  type Funnel,
  type FunnelStep,
  type Grain,
  type Measure,
  type Predicate,
  type ScalarValue,
  type SortDirection,
  type SummaryStat,
  type Window,
} from "@counted/analytics-domain";
import { Duration, Instant } from "@counted/kernel";
import type { AnalysisCodec } from "@counted/adapter-postgres";

type Obj = Readonly<Record<string, unknown>>;

const isObject = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

const GRAINS = ["hour", "day", "week", "month"] as const;
const SUMMARIES = ["total", "average", "peak", "low", "latest"] as const;
const BASES = ["visit", "person"] as const;
const DIRECTIONS = ["asc", "desc"] as const;

/**
 * `source` is read, never re-derived.
 *
 * `FieldRef.parse` infers dimension-versus-property from the name, which is the
 * right rule for untrusted input and the wrong one here: a customer property
 * whose name collides with one of ours is *stored* as a property precisely so
 * the planner can refuse it as shadowed. Re-parsing would silently promote it
 * to our column and answer with our data.
 */
const field = (raw: unknown): FieldRef | null => {
  if (!isObject(raw)) return null;
  const key = str(raw["key"]);
  if (key === null) return null;
  // A stored dimension name this version no longer declares is unreadable, not
  // a property: demoting it would move the filter off our column and onto a
  // customer field of the same name, and the query would still succeed.
  if (raw["source"] === "dimension") return isDimensionName(key) ? FieldRef.dimension(key) : null;
  if (raw["source"] === "property") return FieldRef.property(key);
  return null;
};

const scalar = (raw: unknown): { value: ScalarValue } | null => {
  if (raw === null) return { value: null };
  const t = typeof raw;
  if (t === "string" || t === "boolean") return { value: raw as ScalarValue };
  if (t === "number" && Number.isFinite(raw)) return { value: raw as number };
  return null;
};

const predicate = (raw: unknown, depth = 0): Predicate | null => {
  // A cycle cannot survive JSON, but a hand-written thousand-deep nest can, and
  // this walk is recursive.
  if (depth > 32 || !isObject(raw)) return null;
  const op = raw["op"];

  if (op === "and" || op === "or") {
    const operands = raw["operands"];
    if (!Array.isArray(operands)) return null;
    const parsed: Predicate[] = [];
    for (const operand of operands) {
      const one = predicate(operand, depth + 1);
      if (one === null) return null;
      parsed.push(one);
    }
    return { op, operands: parsed };
  }
  if (op === "not") {
    const operand = predicate(raw["operand"], depth + 1);
    return operand === null ? null : { op, operand };
  }

  const f = field(raw["field"]);
  if (f === null) return null;

  switch (op) {
    case "eq":
    case "neq": {
      const v = scalar(raw["value"]);
      return v === null ? null : { op, field: f, value: v.value };
    }
    case "in":
    case "notIn": {
      const values = raw["values"];
      if (!Array.isArray(values)) return null;
      const parsed: ScalarValue[] = [];
      for (const value of values) {
        const v = scalar(value);
        if (v === null) return null;
        parsed.push(v.value);
      }
      return { op, field: f, values: parsed };
    }
    case "contains":
    case "startsWith":
    case "endsWith": {
      const v = raw["value"];
      return typeof v === "string" ? { op, field: f, value: v } : null;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const v = num(raw["value"]);
      return v === null ? null : { op, field: f, value: v };
    }
    case "exists":
    case "notExists":
      return { op, field: f };
    default:
      return null;
  }
};

const window = (raw: unknown): Window | null => {
  if (!isObject(raw)) return null;
  if (raw["kind"] === "relative") {
    const amount = num(raw["amount"]);
    const unit = oneOf(raw["unit"], GRAINS);
    if (amount === null || unit === null) return null;
    return { kind: "relative", amount, unit };
  }
  if (raw["kind"] === "absolute") {
    const from = num(raw["from"]);
    const to = num(raw["to"]);
    if (from === null || to === null) return null;
    return {
      kind: "absolute",
      from: Instant.fromEpochMillis(from),
      to: Instant.fromEpochMillis(to),
    };
  }
  return null;
};

const measure = (raw: unknown): Measure | null => {
  if (!isObject(raw)) return null;
  if (raw["kind"] === "count") return { kind: "count" };
  if (raw["kind"] === "unique") {
    const basis = oneOf<CountingBasis>(raw["basis"], BASES);
    return basis === null ? null : { kind: "unique", basis };
  }
  if (raw["kind"] === "sum") {
    const name = str(raw["name"]);
    return name === null ? null : { kind: "sum", name };
  }
  return null;
};

const funnelStep = (raw: unknown): FunnelStep | null => {
  if (!isObject(raw)) return null;
  const events = raw["events"];
  if (!Array.isArray(events) || events.length === 0) return null;
  const names: string[] = [];
  for (const event of events) {
    const name = str(event);
    if (name === null) return null;
    names.push(name);
  }

  const label = raw["label"] === undefined ? undefined : str(raw["label"]);
  if (raw["label"] !== undefined && label === null) return null;

  let where: Predicate | undefined;
  if (raw["where"] !== undefined) {
    const parsed = predicate(raw["where"]);
    if (parsed === null) return null;
    where = parsed;
  }

  return {
    events: names,
    ...(where === undefined ? {} : { where }),
    ...(label === undefined || label === null ? {} : { label }),
  };
};

const funnel = (raw: unknown): Funnel | null => {
  if (!isObject(raw)) return null;
  const steps = raw["steps"];
  if (!Array.isArray(steps)) return null;
  const parsed: FunnelStep[] = [];
  for (const step of steps) {
    const one = funnelStep(step);
    if (one === null) return null;
    parsed.push(one);
  }

  const w = window(raw["window"]);
  const basis = oneOf<CountingBasis>(raw["basis"], BASES);
  if (w === null || basis === null) return null;

  // Two spellings are accepted because two layers write this field: the domain
  // stores `conversionWindow: { within }` and the contract calls the same idea
  // `conversionWindowMs`. Reading both costs three lines; reading one and
  // silently defaulting the other would give a funnel a seven-day deadline
  // nobody chose.
  const nested = isObject(raw["conversionWindow"]) ? raw["conversionWindow"]["within"] : undefined;
  const millis = num(nested) ?? num(raw["conversionWindowMs"]);
  if (millis === null) return null;

  return {
    steps: parsed,
    window: w,
    conversionWindow: ConversionWindow.of(Duration.millis(millis)),
    basis,
  };
};

/**
 * A stored value, as an Analysis, or `null` if it is not one.
 *
 * Structural only: whether the question is *sensible* is `Analysis.validate`,
 * and whether the project can answer it is `Analysis.check`. Three questions,
 * kept apart, because "this row is corrupt", "this window is inverted" and
 * "this project has no such dimension" are three different things to tell an
 * operator.
 */
export const parseAnalysis = (raw: unknown): Analysis | null => {
  if (!isObject(raw)) return null;

  if (raw["shape"] === "funnel") {
    const f = funnel(raw["funnel"]);
    return f === null ? null : { shape: "funnel", funnel: f };
  }

  const m = measure(raw["measure"]);
  const w = window(raw["window"]);
  if (m === null || w === null) return null;

  let where: Predicate | undefined;
  if (raw["where"] !== undefined && raw["where"] !== null) {
    const parsed = predicate(raw["where"]);
    if (parsed === null) return null;
    where = parsed;
  }
  const common = { measure: m, window: w, ...(where === undefined ? {} : { where }) };

  switch (raw["shape"]) {
    case "scalar": {
      const summary = oneOf<SummaryStat>(raw["summary"], SUMMARIES);
      return summary === null ? null : { shape: "scalar", ...common, summary };
    }
    case "series": {
      const grain = oneOf<Grain>(raw["grain"], GRAINS);
      return grain === null ? null : { shape: "series", ...common, grain };
    }
    case "breakdown": {
      const by = field(raw["by"]);
      const order = oneOf<SortDirection>(raw["order"], DIRECTIONS);
      const limit = num(raw["limit"]);
      if (by === null || order === null || limit === null) return null;
      if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_BREAKDOWN_LIMIT) return null;
      return { shape: "breakdown", ...common, by, order, limit };
    }
    default:
      return null;
  }
};

export class UnreadableAnalysisError extends Error {
  constructor() {
    super("the stored analysis is not a shape this version understands");
    this.name = "UnreadableAnalysisError";
  }
}

/**
 * The codec the postgres repositories take.
 *
 * `encode` is the identity because the domain form is already JSON: every leaf
 * is a string, a finite number, a boolean or null, and both brands erase.
 */
export const analysisCodec: AnalysisCodec<Analysis> = {
  encode: (analysis) => analysis as unknown,
  decode: (raw) => {
    const parsed = parseAnalysis(raw);
    if (parsed === null) throw new UnreadableAnalysisError();
    return parsed;
  },
};
