/**
 * Counts, uniques and sums per bucket — the three range measures — over
 * summaries, decoded segments and the staging tail, all in one snapshot.
 *
 * The shape of the answer is one accumulator cell per (bucket, group ids),
 * filled from up to three sources chosen by the plan. Every source produces
 * the same three things — a count, a sum, a set of actors — so the merge is
 * one code path and a cell cannot tell where its numbers came from.
 */

import type { PoolClient } from "pg";
import type { ResolvedConfig, ResolvedStream } from "../config.js";
import * as kmv from "../codec/kmv.js";
import { SegmentCache } from "./cache.js";
import { decodedSegments, type FetchStats, throwIfAborted, zoneMap } from "./fetch.js";
import { planRange, type ReadPlan } from "./plan.js";
import { assertSliceable, dimOrdinal, findStream, Params, resolveFilterIds, resolveValues, scopePredicate } from "./scope.js";
import { binOf, toDate, tsExpr, usExpr } from "./time.js";

export type RangeQuery = {
  from: Date | string;
  to: Date | string;
  /** Bucket width as a fixed interval literal: '1 hour', '1 day', '15 minutes'. */
  step: string;
  /** Dimension filters by name. Arrays match any listed value; an empty array matches nothing. */
  filters?: Record<string, string | readonly string[]>;
  /** Break the answer out by these dimensions; each comes back as its own column. */
  groupBy?: readonly string[];
  /** Tenancy scope (required when tenancy is configured). */
  scope?: string | number | bigint;
};

export type Measure = { kind: "counts" } | { kind: "uniques" } | { kind: "sums"; measure: string };

export type QueryOptions = {
  signal?: AbortSignal;
  /** Applied to every statement of the read via SET LOCAL. */
  statementTimeoutMs?: number;
};

export type RangeRow = { bucket: Date } & Record<string, Date | string | number | null>;

export type ReadStats = FetchStats & { path: ReadPlan["path"]; summaryRows: number; tailRows: number; eventsScanned: number };

type Cell = {
  bucketUs: number;
  groups: number[];
  n: number;
  sumInt: bigint;
  sumFloat: number;
  /** Union of every full (k-entry) sketch seen: the only reason to estimate. */
  sketch: kmv.Sketch;
  /** Every actor hash known exactly: decoded events, and sketches below k. */
  exact: Set<bigint>;
  full: boolean;
};

/**
 * Cell keys. A string per event is what makes a 4M-event scan slow, so with
 * no group or one group the key is a number: the bin index scaled past any
 * int4 dictionary id. Two or more groups fall back to a string.
 */
const KEY_SCALE = 2 ** 32;
const cellKey = (bin: number, groups: readonly number[]): number | string =>
  groups.length === 0 ? bin : groups.length === 1 ? bin * KEY_SCALE + groups[0]! : `${bin}|${groups.join(",")}`;

export const runRange = async (
  cfg: ResolvedConfig,
  pool: { connect(): Promise<PoolClient> },
  cache: SegmentCache,
  streamName: string,
  q: RangeQuery,
  measure: Measure,
  opts: QueryOptions,
  onStats?: (stats: ReadStats) => void,
): Promise<RangeRow[]> => {
  const st = findStream(cfg, streamName);
  const groupBy = [...(q.groupBy ?? [])];
  const seen = new Set<string>();
  for (const g of groupBy) {
    assertSliceable(st, g, "group by");
    if (seen.has(g)) throw new Error(`litics: groupBy names ${JSON.stringify(g)} twice`);
    seen.add(g);
  }
  for (const dim of Object.keys(q.filters ?? {})) assertSliceable(st, dim, "filter by");
  // How many dimensions (event_type aside) the question names, filter or
  // group: the summaries answer at most one.
  const slicedDims = new Set([...Object.keys(q.filters ?? {}), ...groupBy].filter((d) => d !== "event_type"));
  const plan = planRange(q, { sliced: slicedDims.size });
  const measureDef = measure.kind === "sums" ? st.measures.find((m) => m.name === measure.measure) : undefined;
  if (measure.kind === "sums" && !measureDef) {
    throw new Error(
      `litics: stream ${JSON.stringify(streamName)} has no measure ${JSON.stringify(measure.measure)}; configured: ${st.measures.map((m) => m.name).join(", ") || "(none)"}`,
    );
  }
  throwIfAborted(opts.signal);

  const stats: ReadStats = { path: plan.path, segments: 0, fetched: 0, cacheHits: 0, summaryRows: 0, tailRows: 0, eventsScanned: 0 };
  const cells = new Map<number | string, Cell>();
  const binOfUs = (bucketUs: number): number => Math.round((bucketUs - plan.originUs) / plan.stepUs);
  const cell = (bucketUs: number, groups: number[]): Cell => {
    const key = cellKey(binOfUs(bucketUs), groups);
    let c = cells.get(key);
    if (!c) {
      c = { bucketUs, groups, n: 0, sumInt: 0n, sumFloat: 0, sketch: kmv.empty(), exact: new Set(), full: false };
      cells.set(key, c);
    }
    return c;
  };
  /** One SQL aggregate expression per measure; every source uses the same three. */
  const aggregate = (alias: string, fromSummary: boolean): string => {
    if (measure.kind === "counts") return fromSummary ? `sum(${alias}.n)::text` : "count(*)::text";
    if (measure.kind === "uniques") {
      return fromSummary
        ? `${cfg.schema}.kmv_union(${alias}.actors)`
        : `${cfg.schema}.kmv_merge('{}'::int8[], array_agg(DISTINCT hashtextextended(${alias}.actor_id::text, 0)))`;
    }
    return `coalesce(sum(${alias}.${measure.measure}), 0)::text`;
  };
  const absorb = (c: Cell, v: unknown): void => {
    if (measure.kind === "counts") c.n += Number(v);
    else if (measure.kind === "uniques") {
      // A sketch with fewer than k entries is not an estimate: it is every
      // distinct hash the cell had. Keep those exact; only a full sketch
      // forces the answer to be estimated.
      const hashes = (v as string[]).map(BigInt);
      if (hashes.length >= kmv.KMV_K) {
        c.full = true;
        c.sketch = kmv.union(c.sketch, kmv.fromHashes(hashes));
      } else {
        for (const h of hashes) c.exact.add(h);
      }
    }
    else if (measureDef!.type === "int8") c.sumInt += BigInt(v as string);
    else c.sumFloat += Number(v);
  };

  const client = await pool.connect();
  let aborted = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (opts.statementTimeoutMs !== undefined) {
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(opts.statementTimeoutMs))}`);
    }
    const filterIds = await resolveFilterIds(client, cfg, st, q.filters);
    if (filterIds === null) {
      await client.query("COMMIT");
      onStats?.(stats);
      return [];
    }
    const groupCol = (alias: string, g: string): string => (g === "event_type" ? `${alias}.event_type` : `coalesce(${alias}.${g}, 0)`);
    const filterSql = (alias: string, p: Params): string =>
      [...filterIds].map(([dim, id]) => `\n   AND ${alias}.${dim} = ANY(${p.add(id)}::int[])`).join("");

    // 1. Interior: summary rows, one per (hour, groups); binned here. With no
    //    dimension named, the base table; with one, its marginal.
    if (plan.interior) {
      const p = new Params();
      const scope = scopePredicate(cfg, "s", p, q.scope);
      const from = p.add(String(plan.interior.fromUs));
      const to = p.add(String(plan.interior.toUs));
      const sliced = [...slicedDims][0];
      const table = sliced === undefined ? `${cfg.schema}.${st.name}_summary` : `${cfg.schema}.${st.name}_summary_dims`;
      // In the marginal table the dimension is (dim, value), not a column of its own.
      const summaryCol = (g: string): string => (g === "event_type" ? "s.event_type" : "s.value");
      const summaryFilter = [...filterIds]
        .map(([dim, id]) => (dim === "event_type" ? `\n   AND s.event_type = ANY(${p.add(id)}::int[])` : `\n   AND s.dim = ${p.add(dimOrdinal(st, dim))} AND s.value = ANY(${p.add(id)}::int[])`))
        .join("");
      const dimPin = sliced !== undefined && !filterIds.has(sliced) ? `\n   AND s.dim = ${p.add(dimOrdinal(st, sliced))}` : "";
      const positions = Array.from({ length: plan.groupBy.length + 1 }, (_, i) => i + 1).join(", ");
      const where = `WHERE s.bucket >= ${tsExpr(from)} AND s.bucket < ${tsExpr(to)}${scope}${summaryFilter}${dimPin}`;
      const gsel = plan.groupBy.map((g, i) => `, ${summaryCol(g)} AS g${i}`).join("");
      const gref = (alias: string): string => plan.groupBy.map((_, i) => `, ${alias}.g${i}`).join("");
      const sql =
        measure.kind === "uniques"
          ? // A sketch union only ever needs the k smallest hashes. The k-th
            // element of any full sketch in a cell bounds them from above, so
            // every array is cut down to its elements below that bound before
            // the distinct-and-sort — most of each array discarded before a
            // sort touches it. Without a full sketch the cell is exact and
            // nothing is cut.
            `WITH cells AS (
               SELECT ${usExpr("s.bucket")} AS b${gsel}, s.actors FROM ${table} s ${where}
             ), caps AS (
               SELECT b${plan.groupBy.map((_, i) => `, g${i}`).join("")}, min(actors[${kmv.KMV_K}]) AS cap
                 FROM cells GROUP BY ${positions}
             )
             SELECT caps.b${gref("caps")}, u.v
               FROM caps, LATERAL (
                 SELECT coalesce(array_agg(h ORDER BY h), '{}'::int8[]) AS v
                   FROM (SELECT DISTINCT h FROM cells c, unnest(c.actors) AS h
                          WHERE c.b = caps.b${plan.groupBy.map((_, i) => ` AND c.g${i} = caps.g${i}`).join("")}
                            AND (caps.cap IS NULL OR h <= caps.cap)
                          ORDER BY h LIMIT ${kmv.KMV_K}) x) u`
          : `SELECT ${usExpr("s.bucket")} AS b${gsel}, ${aggregate("s", true)} AS v
               FROM ${table} s ${where}
              GROUP BY ${positions}`;
      const { rows } = await client.query<Record<string, unknown>>(sql, p.values);
      stats.summaryRows += rows.length;
      for (const r of rows) {
        const values = Object.values(r);
        const bucketUs = binOf(Number(values[0]), plan.originUs, plan.stepUs);
        absorb(cell(bucketUs, values.slice(1, 1 + plan.groupBy.length).map(Number)), values[values.length - 1]);
      }
    }

    // 2. Edges: decode the segments that overlap a sliver; filter every event.
    if (plan.edges.length > 0) {
      const p = new Params();
      const scope = scopePredicate(cfg, "s", p, q.scope);
      const zone = await zoneMap(client, cfg, st, plan.edges, { sql: scope, params: p.values });
      const columns = new Set<string>(["ts"]);
      for (const dim of filterIds.keys()) columns.add(dim);
      for (const g of plan.groupBy) columns.add(g);
      if (measure.kind === "uniques") columns.add("actor");
      if (measure.kind === "sums") columns.add(measure.measure);
      const filters = [...filterIds];
      for await (const { decoded } of decodedSegments(client, cfg, st, zone, [...columns], cache, opts.signal, stats)) {
        const ts = decoded.ts!;
        const column = (name: string): Uint32Array => (name === "event_type" ? decoded.eventType! : decoded.dims![name]!);
        const filterCols = filters.map(([dim, id]) => ({ col: column(dim), ids: new Set(id) }));
        const groupCols = plan.groupBy.map(column);
        const measureCol = measure.kind === "sums" ? decoded.measures![measure.measure]! : undefined;
        const actor = decoded.actor;
        const { originUs, stepUs } = plan;
        const edges = plan.edges;
        // The hot loop. No allocation per event: the bin is arithmetic, the
        // key is a number unless two dimensions are grouped, and the last
        // cell is reused while consecutive events (the segment is sorted by
        // time) land in the same bin and group.
        let lastKey: number | string | null = null;
        let last: Cell | null = null;
        const groupIds: number[] = new Array(groupCols.length);
        for (let i = 0; i < decoded.n; i++) {
          const t = ts[i]!;
          let inside = false;
          for (let e = 0; e < edges.length; e++) {
            const w = edges[e]!;
            if (t >= w.fromUs && t < w.toUs) {
              inside = true;
              break;
            }
          }
          if (!inside) continue;
          let keep = true;
          for (let f = 0; f < filterCols.length; f++) {
            const fc = filterCols[f]!;
            if (!fc.ids.has(fc.col[i]!)) {
              keep = false;
              break;
            }
          }
          if (!keep) continue;
          stats.eventsScanned++;
          const bin = Math.floor((t - originUs) / stepUs);
          for (let g = 0; g < groupCols.length; g++) groupIds[g] = groupCols[g]![i]!;
          const key = cellKey(bin, groupIds);
          let c: Cell;
          if (key === lastKey && last !== null) c = last;
          else {
            const found = cells.get(key);
            if (found) c = found;
            else {
              c = { bucketUs: originUs + bin * stepUs, groups: groupIds.slice(), n: 0, sumInt: 0n, sumFloat: 0, sketch: kmv.empty(), exact: new Set(), full: false };
              cells.set(key, c);
            }
            lastKey = key;
            last = c;
          }
          if (measure.kind === "counts") c.n++;
          else if (measure.kind === "uniques") c.exact.add(actor!.hashes[actor!.index[i]!]!);
          else if (measureCol!.present[i]) {
            if (measureDef!.type === "int8") c.sumInt += (measureCol!.values as BigInt64Array)[i]!;
            else c.sumFloat += (measureCol!.values as Float64Array)[i]!;
          }
        }
      }
    }

    // 3. Tail: whatever is still in staging, binned by SQL at event granularity.
    {
      const p = new Params();
      const scope = scopePredicate(cfg, "e", p, q.scope);
      const from = p.add(String(plan.fromUs));
      const to = p.add(String(plan.toUs));
      const step = p.add(q.step);
      const origin = p.add(String(plan.originUs));
      // Every coalesce expression otherwise arrives under the same PG field
      // name, and object-mode rows overwrite all but the last group.
      const groups = plan.groupBy.map((g, i) => `, ${groupCol("e", g)} AS g${i}`).join("");
      const positions = Array.from({ length: plan.groupBy.length + 1 }, (_, i) => i + 1).join(", ");
      const { rows } = await client.query<Record<string, unknown>>(
        `SELECT ${usExpr(`date_bin(${step}::interval, e.ts, ${tsExpr(origin)})`)} AS b${groups}, ${aggregate("e", false)} AS v
           FROM ${cfg.schema}.${st.name} e
          WHERE e.ts >= ${tsExpr(from)} AND e.ts < ${tsExpr(to)}${scope}${filterSql("e", p)}
          GROUP BY ${positions}`,
        p.values,
      );
      stats.tailRows += rows.length;
      for (const r of rows) {
        absorb(cell(Number(r["b"]), plan.groupBy.map((_, i) => Number(r[`g${i}`]))), r["v"]);
      }
    }

    // 4. Group ids → strings.
    const labels = new Map<string, Map<number, string | null>>();
    for (const [i, g] of plan.groupBy.entries()) {
      labels.set(g, await resolveValues(client, cfg, st, g, [...cells.values()].map((c) => c.groups[i]!)));
    }
    await client.query("COMMIT");

    const rows: RangeRow[] = [...cells.values()].map((c) => {
      const row: Record<string, Date | string | number | null> = { bucket: toDate(c.bucketUs) };
      plan.groupBy.forEach((g, i) => (row[g] = labels.get(g)!.get(c.groups[i]!) ?? null));
      if (measure.kind === "counts") row["n"] = c.n;
      else if (measure.kind === "uniques") {
        // Counted exactly unless some contributor was a full sketch; then
        // the exact hashes join the union and the result is an estimate.
        row["actors"] = c.full ? kmv.estimate(kmv.union(c.sketch, kmv.fromHashes(c.exact))) : c.exact.size;
      } else row["sum"] = measureDef!.type === "int8" ? Number(c.sumInt) : c.sumFloat;
      return row as RangeRow;
    });
    rows.sort((a, b) => {
      const d = a.bucket.getTime() - b.bucket.getTime();
      if (d !== 0) return d;
      for (const g of plan.groupBy) {
        const x = a[g] as string | null;
        const y = b[g] as string | null;
        if (x === y) continue;
        if (x === null) return 1;
        if (y === null) return -1;
        return x < y ? -1 : 1;
      }
      return 0;
    });
    onStats?.(stats);
    return rows;
  } catch (cause) {
    aborted = opts.signal?.aborted === true;
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release(aborted ? new Error("litics: aborted") : undefined);
  }
};
