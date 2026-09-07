/**
 * Field references — one of ours, or one of the customer's, and the IR says
 * which.
 *
 * v1 tested a filter's field name against a `SYSTEM_COLUMNS` allowlist first,
 * so a customer property genuinely named `locale` or `event_name` was silently
 * reinterpreted as our column and quietly returned the wrong numbers. Here the
 * two namespaces cannot collide, because they are different variants — and when
 * a customer property *does* share a name with one of our dimensions, the query
 * planner says so out loud instead of picking one.
 */

import { assertNever } from "@counted/kernel";
import { isDimensionName, type DimensionName } from "./dimension";

export type FieldRef =
  | { readonly source: "dimension"; readonly key: DimensionName }
  | { readonly source: "property"; readonly key: string };

/** What a filter can compare against. Deliberately narrow. */
export type ScalarValue = string | number | boolean | null;

export const FieldRef = {
  dimension: (key: DimensionName): FieldRef => ({ source: "dimension", key }),
  property: (key: string): FieldRef => ({ source: "property", key }),

  /**
   * Read an untrusted field name. A name that matches one of our dimensions is
   * ours; everything else is a customer property. This is the *only* place that
   * inference happens, so there is one rule rather than one per call site.
   */
  parse: (key: string): FieldRef =>
    isDimensionName(key) ? FieldRef.dimension(key) : FieldRef.property(key),

  /** Stable identity, for deduplicating equivalent queries. */
  toKey: (f: FieldRef): string => {
    switch (f.source) {
      case "dimension":
        return `dim:${f.key}`;
      case "property":
        return `prop:${f.key}`;
      default:
        return assertNever(f);
    }
  },

  equals: (a: FieldRef, b: FieldRef): boolean => FieldRef.toKey(a) === FieldRef.toKey(b),

  /**
   * A customer property whose name is already one of our dimensions.
   *
   * There is no honest way to filter such a property from the index: the column of
   * that name holds our value, not theirs. The planner turns this into a stated
   * reason rather than into wrong numbers.
   */
  isShadowed: (f: FieldRef): boolean => f.source === "property" && isDimensionName(f.key),
} as const;
