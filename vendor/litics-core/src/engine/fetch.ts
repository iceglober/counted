/**
 * Reading segments out of Postgres: the zone-map select, then a server-side
 * cursor over the byteas of the segments that are not already decoded.
 *
 * Pull-based on purpose. `FETCH n` hands over a few segments, they are
 * decoded, the next few are fetched — memory is bounded by the batch, not
 * by the window, and an abort between batches destroys the connection
 * rather than draining a result nobody wants.
 */

import type { PoolClient } from "pg";
import type { ResolvedConfig, ResolvedStream } from "../config.js";
import { decode, type DecodedSegment, type Segment } from "../segment.js";
import { fromColumns, SegmentCache } from "./cache.js";
import type { Window } from "./plan.js";
import { tsExpr, usExpr } from "./time.js";

export class AbortError extends Error {
  constructor() {
    super("litics: query aborted");
    this.name = "AbortError";
  }
}

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new AbortError();
};

export type ZoneEntry = { segmentId: number; format: number; n: number; tsMinUs: number; tsMaxUs: number };

/** Segments whose [ts_min, ts_max] touches any of `windows`, in the query's scope. */
export const zoneMap = async (
  client: PoolClient,
  cfg: ResolvedConfig,
  stream: ResolvedStream,
  windows: readonly Window[],
  scope: { sql: string; params: unknown[] },
): Promise<ZoneEntry[]> => {
  if (windows.length === 0) return [];
  const params: unknown[] = [...scope.params];
  const spans = windows.map((w) => {
    params.push(String(w.fromUs), String(w.toUs));
    return `(s.ts_max >= ${tsExpr(`$${params.length - 1}`)} AND s.ts_min < ${tsExpr(`$${params.length}`)})`;
  });
  const { rows } = await client.query<{ segment_id: string; format: number; n: number; ts_min_us: string; ts_max_us: string }>(
    `SELECT s.segment_id, s.format, s.n, ${usExpr("s.ts_min")} AS ts_min_us, ${usExpr("s.ts_max")} AS ts_max_us
       FROM ${cfg.schema}.${stream.name}_segments s
      WHERE (${spans.join(" OR ")})${scope.sql}
      ORDER BY s.segment_id`,
    params,
  );
  return rows.map((r) => ({
    segmentId: Number(r.segment_id),
    format: r.format,
    n: r.n,
    tsMinUs: Number(r.ts_min_us),
    tsMaxUs: Number(r.ts_max_us),
  }));
};

export type FetchStats = { segments: number; fetched: number; cacheHits: number };

/**
 * Yield each segment in `zone` decoded to (at least) `columns`. Cached
 * columns are reused; the rest come through a cursor in batches of `batch`.
 */
export async function* decodedSegments(
  client: PoolClient,
  cfg: ResolvedConfig,
  stream: ResolvedStream,
  zone: readonly ZoneEntry[],
  columns: readonly string[],
  cache: SegmentCache,
  signal: AbortSignal | undefined,
  stats: FetchStats,
  batch = 4,
): AsyncGenerator<{ entry: ZoneEntry; decoded: DecodedSegment }> {
  const dims = stream.dimensions.map((d) => d.name);
  const measures = stream.measures.map((m) => m.name);
  const need = new Map<number, string[]>();
  for (const entry of zone) {
    stats.segments++;
    const { have, missing } = cache.lookup(entry.segmentId, entry.format, columns);
    if (missing.length === 0) {
      stats.cacheHits++;
      yield { entry, decoded: fromColumns(entry.n, have, dims, measures) };
    } else {
      need.set(entry.segmentId, missing);
    }
  }
  if (need.size === 0) return;
  const byId = new Map(zone.map((e) => [e.segmentId, e]));
  // One cursor over the union of missing columns; a segment decodes only its own gaps.
  const wanted = [...new Set([...need.values()].flat())];
  const cursor = "litics_segments";
  await client.query(
    `DECLARE ${cursor} NO SCROLL CURSOR FOR
     SELECT s.segment_id, s.format, s.n, s.raw_bytes, ${usExpr("s.ts_min")} AS ts_min_us, ${usExpr("s.ts_max")} AS ts_max_us, ${wanted.map((c) => `s.${c}`).join(", ")}
       FROM ${cfg.schema}.${stream.name}_segments s
      WHERE s.segment_id = ANY($1::int8[])
      ORDER BY s.segment_id`,
    [[...need.keys()].map(String)],
  );
  try {
    for (;;) {
      throwIfAborted(signal);
      const { rows } = await client.query<Record<string, unknown>>(`FETCH ${batch} FROM ${cursor}`);
      if (rows.length === 0) break;
      for (const row of rows) {
        const id = Number(row["segment_id"]);
        const entry = byId.get(id)!;
        const missing = need.get(id)!;
        const packed: Record<string, Uint8Array> = {};
        for (const c of missing) packed[c] = row[c] as Uint8Array;
        const segment: Segment = {
          format: row["format"] as number,
          tsMin: Number(row["ts_min_us"]),
          tsMax: Number(row["ts_max_us"]),
          n: row["n"] as number,
          columns: packed,
          rawBytes: row["raw_bytes"] as Record<string, number>,
        };
        const fresh = decode(stream, segment, missing);
        stats.fetched++;
        cache.store(id, segment.format, fresh, dims, measures);
        const { have } = cache.lookup(id, segment.format, columns);
        yield { entry, decoded: fromColumns(entry.n, have, dims, measures) };
      }
    }
  } finally {
    await client.query(`CLOSE ${cursor}`).catch(() => undefined);
  }
}
