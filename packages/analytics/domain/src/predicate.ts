/**
 * The predicate sub-language — how an analysis narrows its population.
 *
 * Ported from v2 with its two hard-won properties intact.
 *
 * The ordering comparisons take a `number`, not a `ScalarValue`. v1 compiled
 * `gt`/`lt` to `(col)::numeric > $n` with no guard, unlike the aggregate path
 * which had a regex check, so a single non-numeric value anywhere in the scanned
 * set raised 22P02 and failed the entire insight — which then surfaced as a
 * blank card, because `Promise.allSettled` turned the error into empty data.
 * Here you cannot even express `gt` against a string.
 *
 * The second property is new in v3 and is why this file has a companion,
 * `answerability.ts`: the shape of a predicate decides whether it can be
 * answered off a the index or needs a raw scan. That is a real cost
 * boundary, so the predicate has to be *inspectable*, not just compilable.
 * Every operator below is one the product promises; whether the engine can
 * serve it cheaply is a separate, stated answer.
 */

import { assertNever } from "@counted/kernel";
import { FieldRef, type ScalarValue } from "./field";

export type Predicate =
  | { readonly op: "eq"; readonly field: FieldRef; readonly value: ScalarValue }
  | { readonly op: "neq"; readonly field: FieldRef; readonly value: ScalarValue }
  | { readonly op: "in"; readonly field: FieldRef; readonly values: readonly ScalarValue[] }
  | { readonly op: "notIn"; readonly field: FieldRef; readonly values: readonly ScalarValue[] }
  | { readonly op: "contains"; readonly field: FieldRef; readonly value: string }
  | { readonly op: "startsWith"; readonly field: FieldRef; readonly value: string }
  | { readonly op: "endsWith"; readonly field: FieldRef; readonly value: string }
  | { readonly op: "gt"; readonly field: FieldRef; readonly value: number }
  | { readonly op: "gte"; readonly field: FieldRef; readonly value: number }
  | { readonly op: "lt"; readonly field: FieldRef; readonly value: number }
  | { readonly op: "lte"; readonly field: FieldRef; readonly value: number }
  | { readonly op: "exists"; readonly field: FieldRef }
  | { readonly op: "notExists"; readonly field: FieldRef }
  | { readonly op: "and"; readonly operands: readonly Predicate[] }
  | { readonly op: "or"; readonly operands: readonly Predicate[] }
  | { readonly op: "not"; readonly operand: Predicate };

export type PredicateOp = Predicate["op"];

/** A predicate with the top-level `and`s already flattened away. */
export type Conjunct = Exclude<Predicate, { op: "and" }>;

const scalarKey = (v: ScalarValue): string =>
  v === null ? "null" : `${typeof v}:${String(v)}`;

export const Predicate = {
  eq: (field: FieldRef, value: ScalarValue): Predicate => ({ op: "eq", field, value }),
  neq: (field: FieldRef, value: ScalarValue): Predicate => ({ op: "neq", field, value }),
  in: (field: FieldRef, values: readonly ScalarValue[]): Predicate => ({ op: "in", field, values }),
  notIn: (field: FieldRef, values: readonly ScalarValue[]): Predicate => ({
    op: "notIn",
    field,
    values,
  }),
  contains: (field: FieldRef, value: string): Predicate => ({ op: "contains", field, value }),
  startsWith: (field: FieldRef, value: string): Predicate => ({ op: "startsWith", field, value }),
  endsWith: (field: FieldRef, value: string): Predicate => ({ op: "endsWith", field, value }),
  gt: (field: FieldRef, value: number): Predicate => ({ op: "gt", field, value }),
  gte: (field: FieldRef, value: number): Predicate => ({ op: "gte", field, value }),
  lt: (field: FieldRef, value: number): Predicate => ({ op: "lt", field, value }),
  lte: (field: FieldRef, value: number): Predicate => ({ op: "lte", field, value }),
  exists: (field: FieldRef): Predicate => ({ op: "exists", field }),
  notExists: (field: FieldRef): Predicate => ({ op: "notExists", field }),

  /** `and`/`or` of one collapse; of none is a structural defect validation names. */
  and: (...operands: readonly Predicate[]): Predicate =>
    operands.length === 1 && operands[0] !== undefined ? operands[0] : { op: "and", operands },
  or: (...operands: readonly Predicate[]): Predicate =>
    operands.length === 1 && operands[0] !== undefined ? operands[0] : { op: "or", operands },
  not: (operand: Predicate): Predicate => ({ op: "not", operand }),

  /** Every field this predicate touches, in traversal order, with repeats. */
  fields: (p: Predicate): readonly FieldRef[] => {
    switch (p.op) {
      case "and":
      case "or":
        return p.operands.flatMap(Predicate.fields);
      case "not":
        return Predicate.fields(p.operand);
      case "eq":
      case "neq":
      case "in":
      case "notIn":
      case "contains":
      case "startsWith":
      case "endsWith":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
      case "exists":
      case "notExists":
        return [p.field];
      default:
        return assertNever(p);
    }
  },

  /**
   * Flatten nested `and`s into their leaves. A conjunction of conjunctions is
   * the same population, and the planner only has to recognise one shape.
   */
  conjuncts: (p: Predicate): readonly Conjunct[] =>
    p.op === "and" ? p.operands.flatMap(Predicate.conjuncts) : [p],

  /**
   * Whether this predicate compares the field numerically. An adapter asks so
   * it can emit a guarded cast rather than assuming.
   */
  isNumericComparison: (p: Predicate): boolean =>
    p.op === "gt" || p.op === "gte" || p.op === "lt" || p.op === "lte",

  /**
   * A stable key, structural rather than serialized.
   *
   * v2 built this with `JSON.stringify`, which makes the key depend on property
   * insertion order — fine for predicates built by the constructors above,
   * wrong for one that has been round-tripped through a database column. Two
   * identical questions have to produce one key or the coalescing that stops a
   * dashboard running the same query twice does not fire.
   *
   * `and` and `or` sort their operands' keys, because both are commutative.
   */
  toKey: (p: Predicate): string => {
    switch (p.op) {
      case "and":
      case "or":
        return `${p.op}(${p.operands.map(Predicate.toKey).sort().join(",")})`;
      case "not":
        return `not(${Predicate.toKey(p.operand)})`;
      case "in":
      case "notIn":
        return `${p.op}(${FieldRef.toKey(p.field)},[${p.values.map(scalarKey).sort().join(",")}])`;
      case "exists":
      case "notExists":
        return `${p.op}(${FieldRef.toKey(p.field)})`;
      case "eq":
      case "neq":
        return `${p.op}(${FieldRef.toKey(p.field)},${scalarKey(p.value)})`;
      case "contains":
      case "startsWith":
      case "endsWith":
        return `${p.op}(${FieldRef.toKey(p.field)},string:${p.value})`;
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return `${p.op}(${FieldRef.toKey(p.field)},number:${p.value})`;
      default:
        return assertNever(p);
    }
  },

  equals: (a: Predicate, b: Predicate): boolean => Predicate.toKey(a) === Predicate.toKey(b),
} as const;
