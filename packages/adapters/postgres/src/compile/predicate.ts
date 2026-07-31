/**
 * Predicates to SQL.
 *
 * The one decision that shapes this file: **property equality compiles to
 * containment**, not to text extraction.
 *
 *     properties @> '{"plan":"pro"}'     uses events_properties_gin_idx
 *     properties ->> 'plan' = 'pro'      cannot, and scans regardless
 *
 * That was verified against a real Postgres planner with `enable_seqscan =
 * off` in #33, not assumed. The GIN index is `jsonb_path_ops`, which indexes
 * containment only, so emitting the second form would make the index dead
 * weight and every property filter a sequential scan — which is precisely v1's
 * behaviour, since it had no properties index at all.
 */

import { assertNever, type Predicate, type ScalarValue } from "@counted/domain";
import { PROPERTIES, fieldAsText, systemColumn } from "./column-map";
import { numericFromJsonb, numericFromText } from "./numeric";
import type { Params } from "./params";

/** `properties @> '{"key": value}'` — index-usable equality on a property. */
const containment = (key: string, value: ScalarValue, params: Params): string =>
  `${PROPERTIES} @> ${params.add(JSON.stringify({ [key]: value }))}::jsonb`;

/**
 * A numeric expression for whichever namespace the field lives in. Both routes
 * go through the single guard in numeric.ts, so a non-numeric value yields
 * NULL — the row simply does not match — rather than aborting the statement.
 */
const numeric = (
  field: Extract<Predicate, { op: "gt" }>["field"],
  params: Params,
): string =>
  field.source === "system"
    ? numericFromText(systemColumn(field.key))
    : numericFromJsonb(PROPERTIES, params.add(field.key));

export const compilePredicate = (p: Predicate, params: Params): string => {
  switch (p.op) {
    case "and":
      return `(${p.operands.map((o) => compilePredicate(o, params)).join(" AND ")})`;
    case "or":
      return `(${p.operands.map((o) => compilePredicate(o, params)).join(" OR ")})`;
    case "not":
      return `NOT (${compilePredicate(p.operand, params)})`;

    case "eq":
      // Containment on properties so the GIN index is usable; a plain
      // comparison on a real column, where the btree already serves it.
      return p.field.source === "property"
        ? containment(p.field.key, p.value, params)
        : `${systemColumn(p.field.key)} IS NOT DISTINCT FROM ${params.add(p.value)}`;

    case "neq":
      return p.field.source === "property"
        ? `NOT (${containment(p.field.key, p.value, params)})`
        : `${systemColumn(p.field.key)} IS DISTINCT FROM ${params.add(p.value)}`;

    case "in":
      // A disjunction of containments keeps every branch index-usable. An
      // `->> IN (...)` would be one scan.
      return p.field.source === "property"
        ? `(${p.values.map((v) => containment((p.field as { key: string }).key, v, params)).join(" OR ")})`
        : `${systemColumn(p.field.key)} IN (${params.addAll([...p.values])})`;

    case "notIn":
      return p.field.source === "property"
        ? `NOT (${p.values.map((v) => containment((p.field as { key: string }).key, v, params)).join(" OR ")})`
        : `(${systemColumn(p.field.key)} IS NULL OR ${systemColumn(p.field.key)} NOT IN (${params.addAll([...p.values])}))`;

    // Substring matching cannot use the GIN index by any formulation. It runs
    // inside the project-and-time slice that pruning and the btree have
    // already narrowed, which is documented in UNINDEXED_BY_DESIGN.
    case "contains":
      return `${fieldAsText(p.field, params)} ILIKE ${params.add(`%${escapeLike(p.value)}%`)}`;
    case "startsWith":
      return `${fieldAsText(p.field, params)} ILIKE ${params.add(`${escapeLike(p.value)}%`)}`;
    case "endsWith":
      return `${fieldAsText(p.field, params)} ILIKE ${params.add(`%${escapeLike(p.value)}`)}`;

    case "gt":
      return `${numeric(p.field, params)} > ${params.add(p.value)}`;
    case "gte":
      return `${numeric(p.field, params)} >= ${params.add(p.value)}`;
    case "lt":
      return `${numeric(p.field, params)} < ${params.add(p.value)}`;
    case "lte":
      return `${numeric(p.field, params)} <= ${params.add(p.value)}`;

    case "exists":
      return p.field.source === "property"
        ? `${PROPERTIES} ? ${params.add(p.field.key)}`
        : `${systemColumn(p.field.key)} IS NOT NULL`;
    case "notExists":
      return p.field.source === "property"
        ? `NOT (${PROPERTIES} ? ${params.add(p.field.key)})`
        : `${systemColumn(p.field.key)} IS NULL`;

    default:
      return assertNever(p);
  }
};

/**
 * LIKE metacharacters in user input are literals, not wildcards. Without this,
 * a search for "100%" would match everything beginning with "100".
 */
const escapeLike = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
