/**
 * Three-step funnels, computed in the application.
 *
 * Gzip hides the columns from SQL, so the actor-ordered index the old raw
 * table had is rebuilt in memory: fetch `ts`, `event_type` and `actor` from
 * every segment overlapping the window plus the staging tail, keep only the
 * three step types, sort by (actor hash, ts), and walk each actor's events
 * once. The semantics are the old three-CTE query's exactly: step 1 is the
 * actor's first step-1 event in the window; step 2 the first step-2 event
 * strictly after it and before `least(to, t1 + within)`; step 3 likewise
 * after step 2.
 */

import type { PoolClient } from "pg";
import { intervalSeconds, type ResolvedConfig } from "../config.js";
import { SegmentCache } from "./cache.js";
import { decodedSegments, type FetchStats, throwIfAborted, zoneMap } from "./fetch.js";
import type { QueryOptions } from "./range.js";
import { assertEventType, dimDict, findStream, Params, scopePredicate } from "./scope.js";
import { toMicros, tsExpr, usExpr } from "./time.js";

export type FunnelQuery = {
  from: Date | string;
  to: Date | string;
  /** Max time from step 1 to completion. Default '7 days'. */
  within?: string;
  scope?: string | number | bigint;
};

export type FunnelResult = { step1: number; step2: number; step3: number };

export type FunnelOptions = QueryOptions & {
  /** Refuse rather than hold more step events than this in memory. Default 5,000,000. */
  maxEvents?: number;
};

export const runFunnel = async (
  cfg: ResolvedConfig,
  pool: { connect(): Promise<PoolClient> },
  cache: SegmentCache,
  streamName: string,
  steps: readonly string[],
  q: FunnelQuery,
  opts: FunnelOptions,
  onStats?: (stats: FetchStats & { events: number }) => void,
): Promise<FunnelResult> => {
  const st = findStream(cfg, streamName);
  if (steps.length !== 3) throw new RangeError(`litics: a funnel takes exactly 3 steps in this version, got ${steps.length}`);
  for (const step of steps) assertEventType(st, step);
  const fromUs = toMicros(q.from);
  const toUs = toMicros(q.to);
  if (!(toUs > fromUs)) throw new RangeError("litics: funnel window is empty");
  const withinSeconds = intervalSeconds(q.within ?? "7 days");
  if (withinSeconds === null) throw new RangeError(`litics: within ${JSON.stringify(q.within)} must be a fixed interval`);
  const withinUs = withinSeconds * 1_000_000;
  const maxEvents = opts.maxEvents ?? 5_000_000;
  throwIfAborted(opts.signal);

  const stats: FetchStats & { events: number } = { segments: 0, fetched: 0, cacheHits: 0, events: 0 };
  // The actor hash split into two 32-bit halves: a numeric comparator sorts
  // a million events several times faster than a bigint one, and equality
  // on two numbers is equality on the hash.
  let hi: number[] = [];
  let lo: number[] = [];
  let tss: number[] = [];
  let kinds: number[] = [];
  const push = (hashHi: number, hashLo: number, ts: number, kind: number): void => {
    if (tss.length >= maxEvents) {
      throw new RangeError(`litics: funnel over ${JSON.stringify(streamName)} would hold more than ${maxEvents} step events; narrow the window`);
    }
    hi.push(hashHi);
    lo.push(hashLo);
    tss.push(ts);
    kinds.push(kind);
  };
  const split = (hash: bigint): [number, number] => {
    const u = BigInt.asUintN(64, hash);
    return [Number(u >> 32n), Number(u & 0xffffffffn)];
  };

  const client = await pool.connect();
  let aborted = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (opts.statementTimeoutMs !== undefined) {
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(opts.statementTimeoutMs))}`);
    }
    const p0 = new Params();
    const dict = p0.add(dimDict(st, "event_type"));
    const { rows: ids } = await client.query<{ id: number | null }>(
      `SELECT (SELECT id FROM ${cfg.schema}.dims WHERE dim = ${dict} AND value = v.value) AS id
         FROM unnest(${p0.add(steps)}::text[]) WITH ORDINALITY AS v(value, ord) ORDER BY v.ord`,
      p0.values,
    );
    const typeIds = ids.map((r) => r.id);
    if (typeIds.some((id) => id === null)) {
      await client.query("COMMIT");
      onStats?.(stats);
      return { step1: 0, step2: 0, step3: 0 };
    }
    const [k1, k2, k3] = typeIds as [number, number, number];
    const kindOf = (id: number): number => (id === k1 ? 1 : id === k2 ? 2 : id === k3 ? 3 : 0);

    {
      const p = new Params();
      const scope = scopePredicate(cfg, "s", p, q.scope);
      const zone = await zoneMap(client, cfg, st, [{ fromUs, toUs }], { sql: scope, params: p.values });
      for await (const { decoded } of decodedSegments(client, cfg, st, zone, ["ts", "event_type", "actor"], cache, opts.signal, stats)) {
        const ts = decoded.ts!;
        const et = decoded.eventType!;
        const actor = decoded.actor!;
        // Split the segment's actor dictionary once (a few thousand entries),
        // not once per event.
        const dictHi = new Float64Array(actor.hashes.length);
        const dictLo = new Float64Array(actor.hashes.length);
        for (let d = 0; d < actor.hashes.length; d++) {
          const [h, l] = split(actor.hashes[d]!);
          dictHi[d] = h;
          dictLo[d] = l;
        }
        for (let i = 0; i < decoded.n; i++) {
          const t = ts[i]!;
          if (t < fromUs || t >= toUs) continue;
          const kind = kindOf(et[i]!);
          if (kind === 0) continue;
          const at = actor.index[i]!;
          push(dictHi[at]!, dictLo[at]!, t, kind);
        }
      }
    }
    {
      const p = new Params();
      const scope = scopePredicate(cfg, "e", p, q.scope);
      const from = p.add(String(fromUs));
      const to = p.add(String(toUs));
      const types = p.add([k1, k2, k3]);
      const { rows } = await client.query<{ h: string; ts_us: string; event_type: number }>(
        `SELECT hashtextextended(e.actor_id::text, 0)::text AS h, ${usExpr("e.ts")} AS ts_us, e.event_type
           FROM ${cfg.schema}.${st.name} e
          WHERE e.ts >= ${tsExpr(from)} AND e.ts < ${tsExpr(to)} AND e.event_type = ANY(${types}::int[])${scope}`,
        p.values,
      );
      for (const r of rows) {
        const [h, l] = split(BigInt(r.h));
        push(h, l, Number(r.ts_us), kindOf(r.event_type));
      }
    }
    await client.query("COMMIT");
  } catch (cause) {
    aborted = opts.signal?.aborted === true;
    await client.query("ROLLBACK").catch(() => undefined);
    throw cause;
  } finally {
    client.release(aborted ? new Error("litics: aborted") : undefined);
  }

  stats.events = tss.length;
  // The actor-ordered access path, rebuilt: sort once by (actor, ts).
  const order = new Uint32Array(tss.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((a, b) => hi[a]! - hi[b]! || lo[a]! - lo[b]! || tss[a]! - tss[b]!);

  let step1 = 0;
  let step2 = 0;
  let step3 = 0;
  let i = 0;
  while (i < order.length) {
    const actorHi = hi[order[i]!]!;
    const actorLo = lo[order[i]!]!;
    let t1 = -1;
    let t2 = -1;
    let limit = 0;
    let done = false;
    for (; i < order.length && hi[order[i]!] === actorHi && lo[order[i]!] === actorLo; i++) {
      const at = order[i]!;
      const t = tss[at]!;
      const kind = kinds[at]!;
      if (t1 < 0) {
        if (kind === 1) {
          t1 = t;
          limit = Math.min(toUs, t1 + withinUs);
        }
        continue;
      }
      if (done || t >= limit) continue;
      if (t2 < 0) {
        if (kind === 2 && t > t1) t2 = t;
        continue;
      }
      if (kind === 3 && t > t2) done = true;
    }
    if (t1 >= 0) step1++;
    if (t2 >= 0) step2++;
    if (done) step3++;
  }
  hi = [];
  lo = [];
  tss = [];
  kinds = [];
  onStats?.(stats);
  return { step1, step2, step3 };
};
