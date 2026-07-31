/**
 * Field references to SQL.
 *
 * The domain's `FieldRef` is a two-variant union, so which namespace a field
 * belongs to is decided by the type rather than by looking a name up in a
 * table. v1 tested every filter name against a system allowlist *first*, so a
 * customer property genuinely named `locale` or `event_name` was silently
 * reinterpreted as our column and returned the wrong numbers. That confusion
 * cannot be expressed here: a `{ source: "property" }` never reaches a column.
 */

import { assertNever, type FieldRef, type SystemField } from "@counted/domain";
import type { Params } from "./params";

/**
 * System fields are real columns. The mapping is exhaustive over the domain's
 * union, so adding a `SystemField` without handling it here is a compile
 * error rather than a runtime surprise.
 */
export const systemColumn = (field: SystemField): string => {
  switch (field) {
    case "event_name":
      return "name";
    case "os_name":
      return "os_name";
    case "os_version":
      return "os_version";
    case "locale":
      return "locale";
    case "app_version":
      return "app_version";
    case "device_model":
      return "device_model";
    case "country_code":
      return "country_code";
    case "sdk_version":
      return "sdk_version";
    default:
      return assertNever(field);
  }
};

export const PROPERTIES = "properties";

/**
 * A text expression for a field, for grouping and display.
 *
 * Note this is *not* what equality filters use — see `predicate.ts`. Text
 * extraction cannot use the GIN index, so equality compiles to containment
 * instead. Verified against a real planner in #33.
 */
export const fieldAsText = (field: FieldRef, params: Params): string => {
  switch (field.source) {
    case "system":
      return systemColumn(field.key);
    case "property":
      return `${PROPERTIES} ->> ${params.add(field.key)}`;
    default:
      return assertNever(field);
  }
};

/** A stable label for a grouped value, with NULL and empty folded together. */
export const fieldAsLabel = (field: FieldRef, params: Params): string =>
  `COALESCE(NULLIF(${fieldAsText(field, params)}, ''), 'unknown')`;
