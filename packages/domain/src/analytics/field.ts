/**
 * Field references.
 *
 * A field is either one of ours or one of the customer's, and the IR says
 * which. v1 tested a filter's field name against a `SYSTEM_COLUMNS` allowlist
 * first, so a customer property genuinely named `locale` or `event_name` was
 * silently reinterpreted as our column and quietly returned the wrong numbers.
 * Here the two namespaces cannot collide, because they are different variants.
 */

import { assertNever } from "../shared/brand";

/**
 * The closed set of attributes Counted itself records. Deliberately coarse:
 * every one of these is a bucket many people fall into, never a way to single
 * someone out.
 */
export type SystemField =
  | "event_name"
  | "os_name"
  | "os_version"
  | "locale"
  | "app_version"
  | "device_model"
  | "country_code"
  | "sdk_version";

export const SYSTEM_FIELDS: readonly SystemField[] = [
  "event_name",
  "os_name",
  "os_version",
  "locale",
  "app_version",
  "device_model",
  "country_code",
  "sdk_version",
];

export const isSystemField = (s: string): s is SystemField =>
  (SYSTEM_FIELDS as readonly string[]).includes(s);

export type FieldRef =
  | { readonly source: "system"; readonly key: SystemField }
  | { readonly source: "property"; readonly key: string };

export const FieldRef = {
  system: (key: SystemField): FieldRef => ({ source: "system", key }),
  property: (key: string): FieldRef => ({ source: "property", key }),

  /** Stable identity, for deduplicating equivalent queries. */
  toKey: (f: FieldRef): string => {
    switch (f.source) {
      case "system":
        return `sys:${f.key}`;
      case "property":
        return `prop:${f.key}`;
      default:
        return assertNever(f);
    }
  },

  equals: (a: FieldRef, b: FieldRef): boolean => FieldRef.toKey(a) === FieldRef.toKey(b),
} as const;

/** What a filter can compare against. Deliberately narrow. */
export type ScalarValue = string | number | boolean | null;
