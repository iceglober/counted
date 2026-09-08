/**
 * Decoded-segment cache, byte-budgeted, least-recently-used.
 *
 * Correct by construction: a segment id is never reused, a segment row is
 * never updated (the trigger sees to it), and the zone map is consulted live
 * on every read — so a cached decode can only be stale by no longer being
 * reachable, never by meaning something else. The staging tail is never
 * cached.
 *
 * Entries are per segment and hold whichever columns have been decoded so
 * far; a later query needing a column the entry lacks fetches just that
 * column and merges it in.
 */

import type { Actors, DecodedSegment, NullableBigints, NullableFloats } from "../segment.js";

export type DecodedColumn = Float64Array | Uint32Array | Actors | NullableBigints | NullableFloats | readonly (string | null)[];

type Entry = { format: number; columns: Map<string, DecodedColumn>; bytes: number };

const sizeOf = (column: DecodedColumn): number => {
  if (column instanceof Float64Array || column instanceof Uint32Array) return column.byteLength;
  if (Array.isArray(column)) {
    return (column as readonly (string | null)[]).reduce((acc, s) => acc + (s === null ? 8 : 16 + s.length * 2), 0);
  }
  const rest = column as Actors | NullableBigints | NullableFloats;
  if ("index" in rest) return rest.index.byteLength + rest.hashes.byteLength + rest.values.length * 32;
  return rest.present.byteLength + rest.values.byteLength;
};

export class SegmentCache {
  readonly #entries = new Map<number, Entry>();
  #bytes = 0;
  hits = 0;
  misses = 0;

  constructor(readonly maxBytes: number) {}

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** The cached columns of a segment, or which of `columns` are missing. */
  lookup(segmentId: number, format: number, columns: readonly string[]): { have: Map<string, DecodedColumn>; missing: string[] } {
    const entry = this.#entries.get(segmentId);
    if (!entry || entry.format !== format) {
      this.misses++;
      return { have: new Map(), missing: [...columns] };
    }
    // Touch: Map iteration order is insertion order, so re-inserting is the LRU bump.
    this.#entries.delete(segmentId);
    this.#entries.set(segmentId, entry);
    const missing = columns.filter((c) => !entry.columns.has(c));
    if (missing.length === 0) this.hits++;
    else this.misses++;
    return { have: entry.columns, missing };
  }

  store(segmentId: number, format: number, decoded: DecodedSegment, dims: readonly string[], measures: readonly string[]): void {
    let entry = this.#entries.get(segmentId);
    if (!entry || entry.format !== format) {
      if (entry) this.#bytes -= entry.bytes;
      entry = { format, columns: new Map(), bytes: 0 };
    } else {
      this.#entries.delete(segmentId);
    }
    const put = (name: string, column: DecodedColumn | undefined): void => {
      if (column === undefined || entry!.columns.has(name)) return;
      entry!.columns.set(name, column);
      const bytes = sizeOf(column);
      entry!.bytes += bytes;
      this.#bytes += bytes;
    };
    put("ts", decoded.ts);
    put("event_type", decoded.eventType);
    put("actor", decoded.actor);
    put("session_id", decoded.sessionId);
    put("props", decoded.props);
    for (const d of dims) put(d, decoded.dims?.[d]);
    for (const m of measures) put(m, decoded.measures?.[m]);
    this.#entries.set(segmentId, entry);
    this.#evict();
  }

  #evict(): void {
    for (const [id, entry] of this.#entries) {
      if (this.#bytes <= this.maxBytes) return;
      this.#entries.delete(id);
      this.#bytes -= entry.bytes;
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}

/** Assemble a DecodedSegment view from cached columns. */
export const fromColumns = (n: number, columns: Map<string, DecodedColumn>, dims: readonly string[], measures: readonly string[]): DecodedSegment => {
  const out: {
    n: number;
    ts?: Float64Array;
    eventType?: Uint32Array;
    actor?: Actors;
    sessionId?: NullableBigints;
    dims?: Record<string, Uint32Array>;
    measures?: Record<string, NullableBigints | NullableFloats>;
    props?: (string | null)[];
  } = { n };
  const ts = columns.get("ts");
  if (ts instanceof Float64Array) out.ts = ts;
  const et = columns.get("event_type");
  if (et instanceof Uint32Array) out.eventType = et;
  const actor = columns.get("actor");
  if (actor && !Array.isArray(actor) && "index" in actor) out.actor = actor;
  const session = columns.get("session_id");
  if (session && !Array.isArray(session) && "present" in session && session.values instanceof BigInt64Array) {
    out.sessionId = session as NullableBigints;
  }
  const props = columns.get("props");
  if (Array.isArray(props)) out.props = props as (string | null)[];
  for (const d of dims) {
    const c = columns.get(d);
    if (c instanceof Uint32Array) (out.dims ??= {})[d] = c;
  }
  for (const m of measures) {
    const c = columns.get(m);
    if (c && !Array.isArray(c) && "present" in c) (out.measures ??= {})[m] = c;
  }
  return out;
};
