/**
 * Dimensions — the attributes an analysis is allowed to slice and filter by.
 *
 * This module exists because of a constraint the plan calls out and the rest of
 * the IR is shaped around: litics answers a filter fast only when the filter is
 * over a dimension the store **indexes**. Anything else is a raw scan
 * of the event partitions, which is the thing pre-aggregation exists to avoid.
 * So the set of declared dimensions is not a detail of the adapter — it decides
 * which questions are cheap, and it belongs in the IR where a cost control and
 * a query planner can both read it.
 *
 * Two states, not one. A dimension is `collected` when an event actually
 * carries it today, and `planned` when we have designed for it but nothing
 * fills it yet. The distinction earns its keep by making "we do not have that
 * column" a sentence a query can be refused with, rather than a silently empty
 * chart — which is the failure mode this whole package is built to make
 * impossible.
 *
 * **Every declared dimension is `collected` today.** `country` was the one
 * `planned` entry and no longer is: it is derived at ingest from the request
 * address by `@counted/ingestion-adapter-geoip`, the address is discarded in
 * the same breath, and the store indexes the column. `planned` stays in the model
 * because the next dimension will pass through it — a state with no members is
 * not a state that was wrong.
 *
 * `country` is also the one dimension Counted works out rather than being told.
 * The other seven arrive from an SDK. That difference is invisible here on
 * purpose: by the time a query is planned, a dimension is a column, and where
 * the value came from is `@counted/ingestion-domain`'s business.
 */

import { assertNever } from "@counted/kernel";

/**
 * The closed set of attributes Counted itself records.
 *
 * Deliberately coarse: every one of these is a bucket that many people fall
 * into, never a way to single someone out. Customer-defined properties are a
 * different namespace entirely — see `FieldRef`.
 */
export type DimensionName =
  | "event_type"
  | "os_name"
  | "os_version"
  | "locale"
  | "app_version"
  | "device_model"
  | "sdk_version"
  | "country";

export type DimensionAvailability = "collected" | "planned";

export type DimensionSpec = {
  readonly name: DimensionName;
  readonly availability: DimensionAvailability;
  /** Human label. One place, so the console does not grow a second table. */
  readonly label: string;
  /** Why it is not collected yet. Present only on `planned` dimensions. */
  readonly pending?: string;
};

/**
 * What the SDK sends today, plus the one thing the edge derives.
 *
 * `event_type` is in this list on purpose. In v1 an event-name restriction was
 * its own field on the query (`events: string[]`) *and* a different field on an
 * alert (`eventFilter: string`), so the same restriction had two spellings and
 * two compilers. Here it is a dimension like any other and an event
 * restriction is just `eq(event_type, "purchase")` — one predicate language,
 * one place to get it right.
 */
export const DIMENSIONS: readonly DimensionSpec[] = [
  { name: "event_type", availability: "collected", label: "Event" },
  { name: "os_name", availability: "collected", label: "OS" },
  { name: "os_version", availability: "collected", label: "OS version" },
  { name: "locale", availability: "collected", label: "Locale" },
  { name: "app_version", availability: "collected", label: "App version" },
  { name: "device_model", availability: "collected", label: "Device" },
  { name: "sdk_version", availability: "collected", label: "SDK version" },
  // Not from the SDK. Derived at ingest from the request address, which is then
  // discarded — see `@counted/ingestion-domain`'s `country.ts`. `null` where the
  // address could not be placed, and a null dimension is absent from a
  // breakdown rather than being a bucket called "unknown".
  { name: "country", availability: "collected", label: "Country" },
];

/** The dimension every event carries a value for. */
export const EVENT_TYPE: DimensionName = "event_type";

const BY_NAME = new Map<string, DimensionSpec>(DIMENSIONS.map((d) => [d.name, d]));

export const isDimensionName = (key: string): key is DimensionName => BY_NAME.has(key);

export const dimensionSpec = (name: DimensionName): DimensionSpec => {
  const spec = BY_NAME.get(name);
  // Unreachable: BY_NAME is built from the same closed union.
  if (spec === undefined) return assertNever(name as never);
  return spec;
};

/**
 * Which dimension keys a particular project's index can answer.
 *
 * A catalog is a *value*, passed in, never read from anywhere — the domain has
 * no way to ask a database what a project has seen. The application fills this
 * from `SchemaCatalog` and hands it down; `DEFAULT_CATALOG` is what any project
 * has before a custom dimension is declared.
 *
 * `indexed` may contain customer property names too, because litics can be
 * configured to index a declared property. `planned` is ours: keys
 * the product names but no event carries.
 */
export type DimensionCatalog = {
  readonly indexed: readonly string[];
  readonly planned: readonly string[];
  readonly scanned?: readonly string[];
};

export type DimensionStatus = "indexed" | "planned" | "scanned" | "unknown";

export const DimensionCatalog = {
  of: (indexed: readonly string[], planned: readonly string[] = []): DimensionCatalog => ({
    indexed,
    planned,
  }),

  /** The catalog with the project's own declared dimensions added. */
  withIndexed: (c: DimensionCatalog, extra: readonly string[]): DimensionCatalog => ({
    indexed: [...new Set([...c.indexed, ...extra])],
    planned: c.planned.filter((p) => !extra.includes(p)),
  }),

  status: (c: DimensionCatalog, key: string): DimensionStatus => {
    if (c.indexed.includes(key)) return "indexed";
    if (c.scanned?.includes(key)) return "scanned";
    if (c.planned.includes(key)) return "planned";
    return "unknown";
  },

  keys: (c: DimensionCatalog): readonly string[] => [...c.indexed, ...c.planned, ...(c.scanned ?? [])],
} as const;

/**
 * Every `collected` dimension is indexed, and today that is all of them.
 *
 * `planned` is empty rather than removed. `DimensionCatalog.status` still
 * answers three ways and `plan.ts` still refuses a planned filter by name; the
 * list of names it would refuse is currently nil.
 */
export const DEFAULT_CATALOG: DimensionCatalog = DimensionCatalog.of(
  DIMENSIONS.filter((d) => d.availability === "collected").map((d) => d.name),
  DIMENSIONS.filter((d) => d.availability === "planned").map((d) => d.name),
);
