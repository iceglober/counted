/** Shared pieces of every read: parameters, the tenancy predicate, filter and group-by checks. */

import type { PoolClient } from "pg";
import type { ResolvedConfig, ResolvedStream } from "../config.js";

export class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export const findStream = (cfg: ResolvedConfig, name: string): ResolvedStream => {
  const stream = cfg.streams.find((s) => s.name === name);
  if (!stream) {
    throw new Error(`litics: unknown stream ${JSON.stringify(name)}; configured: ${cfg.streams.map((s) => s.name).join(", ")}`);
  }
  return stream;
};

/** A dimension's position in the stream's declared list — what `_summary_dims.dim` holds. */
export const dimOrdinal = (st: ResolvedStream, name: string): number => {
  const at = st.dimensions.findIndex((d) => d.name === name);
  if (at < 0) throw new Error(`litics: stream ${JSON.stringify(st.name)} has no dimension ${JSON.stringify(name)}`);
  return at;
};

/** The dictionary a dimension's values live in; event types are namespaced per stream. */
export const dimDict = (st: ResolvedStream, dim: string): string => (dim === "event_type" ? `${st.name}.event_type` : dim);

export const assertEventType = (st: ResolvedStream, type: string): void => {
  if (st.eventTypes && !st.eventTypes.includes(type)) {
    throw new Error(
      `litics: event type ${JSON.stringify(type)} is not in stream ${JSON.stringify(st.name)}'s eventTypes [${st.eventTypes.join(", ")}]`,
    );
  }
};

/** A column a read may filter or group by: `event_type` or a declared dimension. */
export const assertSliceable = (st: ResolvedStream, name: string, what: string): void => {
  if (name === "event_type" || st.dimensions.some((d) => d.name === name)) return;
  throw new Error(
    `litics: stream ${JSON.stringify(st.name)} cannot ${what} ${JSON.stringify(name)}; sliceable: event_type${st.dimensions.map((d) => `, ${d.name}`).join("")}`,
  );
};

/**
 * The tenancy predicate, mirroring the generated RLS policy so isolation
 * holds on owner connections too. Primary enforcement; RLS is the backstop.
 */
export const scopePredicate = (
  cfg: ResolvedConfig,
  alias: string,
  p: Params,
  scope: string | number | bigint | undefined,
): string => {
  if (!cfg.tenancy) return "";
  if (scope === undefined || scope === null) {
    throw new Error(
      "litics: tenancy is configured — every query needs a scope. A scope is the org whose data — including its whole subtree, with a hierarchy — the query may see; docs/GUIDE.md §9.",
    );
  }
  const t = cfg.tenancy.type === "int8" ? "bigint" : cfg.tenancy.type;
  const v = p.add(typeof scope === "string" ? scope : scope.toString());
  return cfg.tenancy.hierarchy
    ? `\n   AND ${alias}.tenant_id IN (SELECT descendant FROM ${cfg.schema}.org_tree WHERE ancestor = ${v}::${t})`
    : `\n   AND ${alias}.tenant_id = ${v}::${t}`;
};

/**
 * Resolve allowed strings to dictionary ids in one query. Unknown members of
 * a set are ignored; an empty set matches nothing, never every value.
 */
export const resolveFilterIds = async (
  client: PoolClient,
  cfg: ResolvedConfig,
  st: ResolvedStream,
  filters: Readonly<Record<string, string | readonly string[]>> | undefined,
): Promise<Map<string, readonly number[]> | null> => {
  const entries = Object.entries(filters ?? {});
  const out = new Map<string, readonly number[]>();
  if (entries.length === 0) return out;
  const p = new Params();
  const selects = entries.map(([dim, raw]) => {
    assertSliceable(st, dim, "filter by");
    const values = typeof raw === "string" ? [raw] : [...new Set(raw)];
    if (dim === "event_type") for (const value of values) assertEventType(st, value);
    return `ARRAY(SELECT id FROM ${cfg.schema}.dims WHERE dim = ${p.add(dimDict(st, dim))} AND value = ANY(${p.add(values)}::text[])) AS "${dim}"`;
  });
  const { rows } = await client.query<Record<string, number[]>>(`SELECT ${selects.join(", ")}`, p.values);
  for (const [dim] of entries) {
    const ids = rows[0]?.[dim];
    if (!ids || ids.length === 0) return null;
    out.set(dim, ids);
  }
  return out;
};

/** Dictionary ids → the strings they stand for; 0 (the null sentinel) → null. */
export const resolveValues = async (
  client: PoolClient,
  cfg: ResolvedConfig,
  st: ResolvedStream,
  dim: string,
  ids: Iterable<number>,
): Promise<Map<number, string | null>> => {
  const out = new Map<number, string | null>([[0, null]]);
  const wanted = [...new Set(ids)].filter((id) => id !== 0);
  if (wanted.length === 0) return out;
  const { rows } = await client.query<{ id: number; value: string }>(
    `SELECT id, value FROM ${cfg.schema}.dims WHERE dim = $1 AND id = ANY($2::int[])`,
    [dimDict(st, dim), wanted],
  );
  for (const r of rows) out.set(r.id, r.value);
  return out;
};
