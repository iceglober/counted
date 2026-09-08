/**
 * Ingest builders, all scoped to a stream. Each returns `{ sql, parameters }`
 * with $1..$n placeholders — adapters execute them verbatim (pg via
 * client.query, Kysely via CompiledQuery.raw, etc.). Reads live in the
 * engine (`createEngine`), which needs a connection of its own.
 */

import type { ResolvedConfig, ResolvedStream } from "./config.js";

export interface SqlStatement {
  sql: string;
  parameters: unknown[];
}

export interface TrackEvent {
  /** number/bigint for int8 streams; string for uuid/text streams. */
  actor: number | bigint | string;
  /** Required when tenancy is configured: the MOST SPECIFIC org the event
   * belongs to (e.g. the location, not the partner). */
  tenant?: string | number | bigint;
  /** Event type name; dictionary-encoded server-side, namespaced per stream. */
  type: string;
  ts?: Date | string;
  props?: Record<string, unknown>;
  session?: number | bigint | null;
  /** Provide a UUIDv7 for time-ordered ids; defaults to gen_random_uuid(). */
  eventId?: string;
  /** Values for the stream's dimensions, by name: { country: 'US' }. */
  dims?: Record<string, string | null | undefined>;
  /** Values for the stream's measures, by name: { billed_cents: 12500 }. */
  measures?: Record<string, number | bigint | null | undefined>;
}

class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function findStream(cfg: ResolvedConfig, name: string): ResolvedStream {
  const stream = cfg.streams.find((s) => s.name === name);
  if (!stream) {
    throw new Error(
      `litics: unknown stream ${JSON.stringify(name)}; configured: ${cfg.streams.map((s) => s.name).join(", ")}`,
    );
  }
  return stream;
}

/** Event types are dictionary-encoded under '<stream>.event_type'. */
function typeDict(stream: ResolvedStream): string {
  return `${stream.name}.event_type`;
}

function tenantParam(
  cfg: ResolvedConfig,
  e: TrackEvent,
): string | null {
  if (!cfg.tenancy) return null;
  if (e.tenant === undefined || e.tenant === null) {
    throw new Error("litics: tenancy is configured — every tracked event needs a tenant");
  }
  return typeof e.tenant === "string" ? e.tenant : e.tenant.toString();
}

function actorCast(st: ResolvedStream): string {
  return st.actorType === "int8" ? "bigint" : st.actorType;
}

/** Enforce a stream's declared closed set of event types, if any. */
function assertEventType(st: ResolvedStream, type: string): void {
  if (st.eventTypes && !st.eventTypes.includes(type)) {
    throw new Error(
      `litics: event type ${JSON.stringify(type)} is not in stream ${JSON.stringify(st.name)}'s eventTypes [${st.eventTypes.join(", ")}]`,
    );
  }
}

export function track(cfg: ResolvedConfig, streamName: string, e: TrackEvent): SqlStatement {
  const s = cfg.schema;
  const st = findStream(cfg, streamName);
  assertEventType(st, e.type);
  const p = new Params();
  const ts = p.add(e.ts ?? null);
  const id = p.add(e.eventId ?? null);
  const actor = p.add(toActorParam(e.actor));
  const tenantExpr = cfg.tenancy
    ? `${p.add(tenantParam(cfg, e))}::${cfg.tenancy.type === "int8" ? "bigint" : cfg.tenancy.type},\n        `
    : "";
  const session = p.add(e.session == null ? null : toBigintParam(e.session));
  const type = p.add(e.type);
  const dimExprs = st.dimensions.map((d) => {
    const v = p.add(e.dims?.[d.name] ?? null);
    return `CASE WHEN ${v}::text IS NULL THEN NULL
            ELSE ${s}.ensure_dim('${d.name}', ${v})::${d.type} END`;
  });
  const measureExprs = st.measures.map((m) => {
    const v = p.add(toMeasureParam(e.measures?.[m.name]));
    return `${v}::${m.type === "int8" ? "bigint" : "float8"}`;
  });
  const props = p.add(e.props ? JSON.stringify(e.props) : null);
  const dimCols = st.dimensions.map((d) => d.name);
  const measureCols = st.measures.map((m) => m.name);
  return {
    sql: `INSERT INTO ${s}.${st.name} (ts, event_id, actor_id, ${cfg.tenancy ? "tenant_id, " : ""}session_id, event_type${withLeadingComma(dimCols)}${withLeadingComma(measureCols)}, props)
VALUES (coalesce(${ts}::timestamptz, now()),
        coalesce(${id}::uuid, gen_random_uuid()),
        ${actor}::${actorCast(st)},
        ${tenantExpr}${session}::bigint,
        ${s}.ensure_dim('${typeDict(st)}', ${type})${withLeadingComma(dimExprs)}${withLeadingComma(measureExprs)},
        coalesce(${props}::jsonb, '{}'))`,
    parameters: p.values,
  };
}

/** One round trip for many events: a single jsonb array parameter. */
export function trackBatch(cfg: ResolvedConfig, streamName: string, events: TrackEvent[]): SqlStatement {
  const s = cfg.schema;
  const st = findStream(cfg, streamName);
  for (const e of events) assertEventType(st, e.type);
  const rows = events.map((e) => ({
    ts: e.ts instanceof Date ? e.ts.toISOString() : (e.ts ?? null),
    event_id: e.eventId ?? null,
    actor: toActorParam(e.actor),
    tenant: tenantParam(cfg, e),
    session: e.session == null ? null : String(e.session),
    type: e.type,
    props: e.props ?? {},
    ...Object.fromEntries(st.dimensions.map((d) => [d.name, e.dims?.[d.name] ?? null])),
    ...Object.fromEntries(
      st.measures.map((m) => [m.name, toMeasureParam(e.measures?.[m.name])]),
    ),
  }));
  const dimCols = st.dimensions.map((d) => d.name);
  const measureCols = st.measures.map((m) => m.name);
  const dimSelects = st.dimensions.map(
    (d) => `CASE WHEN e->>'${d.name}' IS NULL THEN NULL
            ELSE ${s}.ensure_dim('${d.name}', e->>'${d.name}')::${d.type} END`,
  );
  const measureSelects = st.measures.map(
    (m) => `(e->>'${m.name}')::${m.type === "int8" ? "bigint" : "float8"}`,
  );
  return {
    sql: `INSERT INTO ${s}.${st.name} (ts, event_id, actor_id, ${cfg.tenancy ? "tenant_id, " : ""}session_id, event_type${withLeadingComma(dimCols)}${withLeadingComma(measureCols)}, props)
SELECT coalesce((e->>'ts')::timestamptz, now()),
       coalesce((e->>'event_id')::uuid, gen_random_uuid()),
       (e->>'actor')::${actorCast(st)},
       ${cfg.tenancy ? `(e->>'tenant')::${cfg.tenancy.type === "int8" ? "bigint" : cfg.tenancy.type},\n       ` : ""}(e->>'session')::bigint,
       ${s}.ensure_dim('${typeDict(st)}', e->>'type')${withLeadingComma(dimSelects)}${withLeadingComma(measureSelects)},
       coalesce(e->'props', '{}'::jsonb)
  FROM jsonb_array_elements($1::jsonb) AS e`,
    parameters: [JSON.stringify(rows)],
  };
}

/**
 * Run the generated backfill function for one of the stream's sources:
 * copies rows with ts in [from, to) from the source table into the stream
 * (creating historical partitions as needed). Returns rows copied.
 * Backfill up to the moment migrations installed the trigger; the trigger
 * covers everything after.
 */
export function backfill(
  cfg: ResolvedConfig,
  streamName: string,
  table: string,
  range: { from: Date | string; to: Date | string },
): SqlStatement {
  const st = findStream(cfg, streamName);
  const src = st.sources.find((s) => s.table === table);
  if (!src) {
    throw new Error(
      `litics: stream ${JSON.stringify(streamName)} has no source ${JSON.stringify(table)}; configured: ${st.sources.map((s) => s.table).join(", ") || "(none)"}`,
    );
  }
  const fn = `${cfg.schema}.backfill_${st.name}_from_${src.table.replace(".", "_")}`;
  return {
    sql: `SELECT ${fn}($1::timestamptz, $2::timestamptz)::float8 AS rows`,
    parameters: [range.from, range.to],
  };
}

/** Dictionary id for a dimension value (null result = value never seen). */
export function dimId(cfg: ResolvedConfig, dim: string, value: string): SqlStatement {
  return {
    sql: `SELECT id FROM ${cfg.schema}.dims WHERE dim = $1 AND value = $2`,
    parameters: [dim, value],
  };
}

function withLeadingComma(parts: string[]): string {
  return parts.length === 0 ? "" : ", " + parts.join(", ");
}

function toBigintParam(value: number | bigint): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function toActorParam(value: number | bigint | string): string {
  return typeof value === "string" ? value : toBigintParam(value);
}

function toMeasureParam(value: number | bigint | null | undefined): string | number | null {
  if (value == null) return null;
  return typeof value === "bigint" ? value.toString() : value;
}
