/**
 * The predicate sub-language — how an analysis narrows its population.
 *
 * The important detail is that the ordering comparisons take a `number`, not a
 * `ScalarValue`. v1 compiled `gt`/`lt` to `(col)::numeric > $n` with no guard,
 * unlike the aggregate path which had a regex check, so a single non-numeric
 * value anywhere in the scanned set raised 22P02 and failed the entire insight
 * — which then surfaced as a blank card, because `Promise.allSettled` turned
 * the error into empty data. Here you cannot even express `gt` against a
 * string, so the compiler is free to emit a guarded cast and mean it.
 */

import { assertNever } from "../shared/brand";
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

export const Predicate = {
  eq: (field: FieldRef, value: ScalarValue): Predicate => ({ op: "eq", field, value }),
  neq: (field: FieldRef, value: ScalarValue): Predicate => ({ op: "neq", field, value }),
  in: (field: FieldRef, values: readonly ScalarValue[]): Predicate => ({ op: "in", field, values }),
  notIn: (field: FieldRef, values: readonly ScalarValue[]): Predicate => ({ op: "notIn", field, values }),
  contains: (field: FieldRef, value: string): Predicate => ({ op: "contains", field, value }),
  startsWith: (field: FieldRef, value: string): Predicate => ({ op: "startsWith", field, value }),
  endsWith: (field: FieldRef, value: string): Predicate => ({ op: "endsWith", field, value }),
  gt: (field: FieldRef, value: number): Predicate => ({ op: "gt", field, value }),
  gte: (field: FieldRef, value: number): Predicate => ({ op: "gte", field, value }),
  lt: (field: FieldRef, value: number): Predicate => ({ op: "lt", field, value }),
  lte: (field: FieldRef, value: number): Predicate => ({ op: "lte", field, value }),
  exists: (field: FieldRef): Predicate => ({ op: "exists", field }),
  notExists: (field: FieldRef): Predicate => ({ op: "notExists", field }),

  /** `and`/`or` of one collapse; of none is a structural error caught by validation. */
  and: (...operands: readonly Predicate[]): Predicate =>
    operands.length === 1 && operands[0] !== undefined ? operands[0] : { op: "and", operands },
  or: (...operands: readonly Predicate[]): Predicate =>
    operands.length === 1 && operands[0] !== undefined ? operands[0] : { op: "or", operands },
  not: (operand: Predicate): Predicate => ({ op: "not", operand }),

  /** Every field this predicate touches. Used to validate against a schema. */
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
   * Whether this predicate compares the field numerically. The compiler asks
   * so it can emit a guarded cast rather than assuming.
   */
  isNumericComparison: (p: Predicate): boolean =>
    p.op === "gt" || p.op === "gte" || p.op === "lt" || p.op === "lte",
} as const;
