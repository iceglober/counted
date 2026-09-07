/** Bounded exact reads of JSON properties, across packed events and the live tail. */
import { decode, type ResolvedConfig, type ResolvedStream, type Segment } from "@litics/core";
import { Predicate, type FieldRef } from "@counted/analytics-domain";
import type { Bounds, EngineScope, QueryOptions, SeriesQuery, BreakdownQuery, Series, Breakdown, FunnelQuery, FunnelCounts } from "@counted/analytics-ports";
import { Duration, Instant, unbrand } from "@counted/kernel";
import { resolved, STREAM, INDEXED_DIMENSIONS, FUNNEL_MAX_DAYS } from "./config";
import { gridStarts } from "./bucketing";
import type { QueryClient, QueryPool, Row } from "./execute";

export const MAX_RAW_EVENTS = 250_000;
const MAX_RAW_BYTES = 64 * 1024 * 1024;
export type RawEvent = { ts: number; actor: string; dimensions: Record<string, string | null>; properties: Record<string, unknown> };
export class ScanLimit extends RangeError {}

const scopeOf = (scope: EngineScope) => unbrand(scope.level === "project" ? scope.project : scope.workspace);
const tableScope = (cfg: ResolvedConfig, alias: string, scope: EngineScope) => scope.level === "workspace" && cfg.tenancy?.hierarchy
  ? `${alias}.tenant_id IN (SELECT descendant FROM ${cfg.schema}.org_tree WHERE ancestor = $1::text)`
  : `${alias}.tenant_id = $1::text`;
const propsOf = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};
const configStream = (cfg: ResolvedConfig) => cfg.streams.find((stream) => stream.name === STREAM)!;

export class RawPropertyReader {
  constructor(readonly pool: QueryPool, readonly cfg = resolved) {}

  async read(scope: EngineScope, bounds: Bounds, options: QueryOptions): Promise<RawEvent[]> {
    if (Duration.toMillis(Instant.between(bounds.from, bounds.to)) > Duration.toMillis(Duration.days(FUNNEL_MAX_DAYS)))
      throw new ScanLimit(`Event scans cover up to ${FUNNEL_MAX_DAYS} days. Choose a shorter period.`);
    const deadline = performance.now() + Duration.toMillis(options.deadline);
    const check = () => {
      if (options.signal?.aborted) throw new Error("The query was canceled.");
      if (performance.now() >= deadline) { const error = new Error("Event scan timed out."); Object.assign(error, { code: "57014" }); throw error; }
    };
    check();
    const connect = this.pool.connect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; const error = new Error("Event scan timed out waiting for a connection."); Object.assign(error, {code: "57014"}); reject(error); }, Math.max(1, deadline - performance.now())); });
    connect.then((connection) => { if (expired) connection.release(); }, () => {});
    const client = await Promise.race([connect, timeout]).finally(() => clearTimeout(timer));
    const stream = configStream(this.cfg);
    const dims = ["event_type", ...stream.dimensions.map((one) => one.name)];
    const params = [scopeOf(scope), Instant.toISO(bounds.from), Instant.toISO(bounds.to)];
    const records: {ts: number; actor: string; dims: Record<string, number>; props: Record<string, unknown>}[] = [];
    let bytes = 0;
    const push = (ts: number, actor: string, encoded: Record<string, number>, props: unknown) => {
      if (records.length >= MAX_RAW_EVENTS) throw new ScanLimit(`This event scan exceeds ${MAX_RAW_EVENTS.toLocaleString("en-US")} events. Choose a shorter period.`);
      const json = typeof props === "string" ? props : JSON.stringify(props ?? {});
      bytes += json.length * 2 + 128;
      if (bytes > MAX_RAW_BYTES) throw new ScanLimit("This event scan exceeds its memory budget. Choose a shorter period.");
      records.push({ ts, actor, dims: encoded, props: propsOf(props) });
    };
    const query = async (sql: string, values?: unknown[]) => {
      check();
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.ceil(deadline - performance.now()))}`);
      return client.query(sql, values);
    };
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await query(`DECLARE counted_property_segments NO SCROLL CURSOR FOR SELECT s.*,
        (extract(epoch FROM s.ts_min) * 1000000)::text AS ts_min_us,
        (extract(epoch FROM s.ts_max) * 1000000)::text AS ts_max_us
        FROM ${this.cfg.schema}.${STREAM}_segments s WHERE ${tableScope(this.cfg, "s", scope)}
        AND s.ts_max >= $2::timestamptz AND s.ts_min < $3::timestamptz ORDER BY s.segment_id`, params);
      for (;;) {
        const {rows} = await query("FETCH 1 FROM counted_property_segments");
        if (!rows.length) break;
        const row = rows[0]!;
        const columns = ["ts", "actor", "event_type", "props", ...stream.dimensions.map((one) => one.name)];
        const decoded = decode(stream, segmentOf(row, columns), columns);
        for (let i = 0; i < decoded.n; i++) {
          if (i % 256 === 0) check();
          const ts = decoded.ts![i]! / 1000;
          if (ts < Instant.toEpochMillis(bounds.from) || ts >= Instant.toEpochMillis(bounds.to)) continue;
          const encoded: Record<string, number> = {event_type: decoded.eventType![i]!};
          for (const dim of stream.dimensions) encoded[dim.name] = decoded.dims![dim.name]![i]!;
          push(ts, BigInt.asUintN(64, decoded.actor!.hashes[decoded.actor!.index[i]!]!).toString(), encoded, decoded.props![i]);
        }
      }
      await query("CLOSE counted_property_segments");
      await query(`DECLARE counted_property_tail NO SCROLL CURSOR FOR SELECT e.ts, hashtextextended(e.actor_id::text, 0)::text AS actor, ${dims.map((name) => `e.${name}`).join(", ")}, e.props
        FROM ${this.cfg.schema}.${STREAM} e WHERE ${tableScope(this.cfg, "e", scope)} AND e.ts >= $2::timestamptz AND e.ts < $3::timestamptz`, params);
      for (;;) {
        const {rows} = await query("FETCH 256 FROM counted_property_tail");
        if (!rows.length) break;
        for (const row of rows) push(new Date(row["ts"] as string).getTime(), BigInt.asUintN(64, BigInt(row["actor"] as string)).toString(), Object.fromEntries(dims.map((dim) => [dim, Number(row[dim] ?? 0)])), row["props"]);
      }
      await query("CLOSE counted_property_tail");
      const dictionary = new Map<string, Map<number, string>>();
      for (const dim of dims) {
        const ids = [...new Set(records.map((one) => one.dims[dim]!).filter(Boolean))];
        const {rows} = ids.length ? await query(`SELECT id, value FROM ${this.cfg.schema}.dims WHERE dim = $1 AND id = ANY($2::int[])`, [dim === "event_type" ? `${STREAM}.event_type` : dim, ids]) : {rows: []};
        dictionary.set(dim, new Map(rows.map((row) => [Number(row["id"]), String(row["value"])])));
      }
      await client.query("COMMIT");
      check();
      return records.map((one) => ({ts: one.ts, actor: one.actor, properties: one.props, dimensions: Object.fromEntries(dims.map((dim) => [dim, dictionary.get(dim)!.get(one.dims[dim]!) ?? null]))}));
    } catch (error) { discard = true; throw error; }
    finally { client.release(discard); }
  }
}

export function segmentOf(row: Row, columns: readonly string[]): Segment {
  return { format: Number(row["format"]), n: Number(row["n"]), tsMin: Number(row["ts_min_us"]), tsMax: Number(row["ts_max_us"]), rawBytes: row["raw_bytes"] as Record<string, number>, columns: Object.fromEntries(columns.map((name) => [name, row[name] as Uint8Array])) };
}
const fieldValue = (event: RawEvent, field: FieldRef): unknown => field.source === "property" ? field.key.startsWith("$") ? undefined : event.properties[field.key] : event.dimensions[field.key];
export const matches = (event: RawEvent, p: Predicate): boolean => {
  if (p.op === "and") return p.operands.every((one) => matches(event, one));
  if (p.op === "or") return p.operands.some((one) => matches(event, one));
  if (p.op === "not") return !matches(event, p.operand);
  const value = fieldValue(event, p.field);
  switch (p.op) {
    case "eq": return value === p.value;
    case "neq": return value !== p.value;
    case "in": return p.values.some((one) => value === one);
    case "notIn": return !p.values.some((one) => value === one);
    case "exists": return value !== undefined && value !== null;
    case "notExists": return value === undefined || value === null;
    case "contains": return typeof value === "string" && value.includes(p.value);
    case "startsWith": return typeof value === "string" && value.startsWith(p.value);
    case "endsWith": return typeof value === "string" && value.endsWith(p.value);
    case "gt": return typeof value === "number" && value > p.value;
    case "gte": return typeof value === "number" && value >= p.value;
    case "lt": return typeof value === "number" && value < p.value;
    case "lte": return typeof value === "number" && value <= p.value;
  }
};
export const needsRaw = (query: SeriesQuery | BreakdownQuery) => !!query.predicate ||
  (query.by !== undefined && (typeof query.by === "string" ? [query.by] : query.by).some((name) => name.startsWith("property:")));
const valueAt = (event: RawEvent, key: string): string | null => {
  const value = key.startsWith("property:") ? fieldValue(event, {source: "property", key: key.slice(9)}) : event.dimensions[key];
  return value === null || value === undefined ? null : typeof value === "object" ? JSON.stringify(value) : String(value);
};
const included = (event: RawEvent, query: Omit<SeriesQuery, "by">) => (!query.predicate || matches(event, query.predicate)) &&
  (query.event === undefined || (typeof query.event === "string" ? [query.event] : query.event).includes(event.dimensions["event_type"]!)) &&
  Object.entries(query.filters ?? {}).every(([key, value]) => valueAt(event, key) === value);

export function rawSeries(events: RawEvent[], query: SeriesQuery, unique: boolean): Series {
  const starts = gridStarts(query.bounds.from, query.bounds.to, query.step);
  const edges = (query.wholeWindow ? starts.slice(0, 1) : starts).map(Instant.toEpochMillis);
  const groups = new Map<string | null, {n: number; actors: Set<string>}[]>();
  if (!query.by) groups.set(null, edges.map(() => ({n: 0, actors: new Set()})));
  for (const event of events) {
    if (!included(event, query)) continue;
    const key = query.by ? valueAt(event, query.by) : null;
    if (!groups.has(key) && (groups.size + 1) * edges.length > 100_000) throw new ScanLimit("This property split has too many groups and time intervals. Choose a coarser interval or filter the property.");
    const buckets = groups.get(key) ?? edges.map(() => ({n: 0, actors: new Set<string>()}));
    let lo = 0, hi = edges.length;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (edges[mid]! <= event.ts) lo = mid + 1; else hi = mid; }
    const bucket = buckets[lo - 1];
    if (!bucket) continue;
    bucket.n++; if (unique) bucket.actors.add(event.actor); groups.set(key, buckets);
  }
  const values = [...groups].map(([key, buckets]) => ({key, buckets: buckets.map((one, index) => ({start: Instant.fromEpochMillis(edges[index]!), value: unique ? one.actors.size : one.n}))}));
  return query.by ? {buckets: [], groups: values} : {buckets: values[0]?.buckets ?? []};
}
export function rawBreakdown(events: RawEvent[], query: BreakdownQuery, unique: boolean): Breakdown {
  const fields = typeof query.by === "string" ? [query.by] : query.by;
  const groups = new Map<string, {keys: (string | null)[]; n: number; actors: Set<string>}>();
  for (const event of events) {
    if (!included(event, query)) continue;
    const keys = fields.map((key) => valueAt(event, key));
    const key = JSON.stringify(keys);
    const group = groups.get(key) ?? {keys, n: 0, actors: new Set<string>()};
    group.n++; if (unique) group.actors.add(event.actor); groups.set(key, group);
  }
  return {rows: [...groups.values()].map((one) => ({key: one.keys.length === 1 ? one.keys[0]! : JSON.stringify(one.keys), ...(one.keys.length > 1 ? {keys: one.keys} : {}), value: unique ? one.actors.size : one.n})).sort((a, b) => (query.order === "desc" ? b.value - a.value : a.value - b.value) || (a.key ?? "").localeCompare(b.key ?? "")).slice(0, query.limit)};
}


/** Ordered visit funnel. Each stage consumes a distinct, strictly later event. */
export function rawFunnel(events: readonly RawEvent[], query: FunnelQuery): FunnelCounts {
  const names = new Set(query.steps);
  const ordered = events.filter((event) => names.has(event.dimensions["event_type"] ?? ""))
    .sort((a,b) => a.actor.localeCompare(b.actor) || a.ts-b.ts);
  const counts: [number, number, number] = [0,0,0];
  const within = Duration.toMillis(query.within ?? Duration.days(7));
  let actor: string | undefined;
  let stage = 0;
  let previous = 0;
  let deadline = 0;
  for (const event of ordered) {
    if (actor !== event.actor) { actor = event.actor; stage = 0; }
    if (stage === 3 || event.dimensions["event_type"] !== query.steps[stage]) continue;
    if (stage > 0 && (event.ts <= previous || event.ts >= deadline)) continue;
    if (stage === 0) deadline = Math.min(Instant.toEpochMillis(query.bounds.to), event.ts + within);
    counts[stage as 0 | 1 | 2] += 1;
    previous = event.ts;
    stage += 1;
  }
  return {counts};
}
