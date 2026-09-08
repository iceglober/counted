/**
 * Segments: `pack()` turns staged rows into one immutable row of gzipped
 * columns plus its per-hour summary; `decode()` turns the columns back into
 * typed arrays. Both are pure — no Postgres, no clock — so a segment written
 * on one machine decodes identically on any other, and a test can prove it
 * without a database.
 *
 * The format is versioned. `SEGMENT_FORMAT` is stamped on every row;
 * `decode` refuses a row whose stamp it does not understand rather than
 * guess, and a golden segment per format ever shipped lives under
 * `test/golden/` and must decode forever.
 *
 * Time is microseconds since the epoch, as a JavaScript number. Postgres
 * stores timestamps at microsecond precision, so this is lossless, and
 * 2^53 µs is the year 2255. A segment's `ts_min`/`ts_max` are the first and
 * last event after sorting, so the zone map is exact.
 *
 * Nulls: dimension ids use 0 (the dictionary starts at 1). Session ids and
 * measures carry a presence bitmap. Props: `null` and `{}` are the same
 * thing — nothing to say — and both decode to `null`.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import type { ResolvedStream } from "./config.js";
import {
  type ActorType,
  type ActorValue,
  type Actors,
  decodeActors,
  decodeBigints,
  decodeDeltas,
  decodeFloats,
  decodeInts,
  decodeStrings,
  encodeActors,
  encodeBigints,
  encodeDeltas,
  encodeFloats,
  encodeInts,
  encodeStrings,
  type NullableBigints,
  type NullableFloats,
} from "./codec/columns.js";
import * as kmv from "./codec/kmv.js";

export type { ActorType, ActorValue, Actors, NullableBigints, NullableFloats };

/** The on-disk layout this code writes. Bump when any column's bytes change meaning. */
export const SEGMENT_FORMAT = 1;

/** Microseconds in an hour: the summary's bucket width. */
export const HOUR_US = 3_600_000_000;

/** No column may inflate past this. A segment holds ~10k events; 256 MiB is a bomb, not data. */
export const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

/**
 * The packer refuses a batch whose props alone would exceed this before
 * compression; the compactor then packs fewer rows. Keeps one enormous
 * property bag from producing a segment every read of that hour must inflate.
 */
export const MAX_PROPS_BYTES = 8 * 1024 * 1024;

export class SegmentTooLargeError extends RangeError {
  constructor(readonly column: string, readonly bytes: number) {
    super(`litics: column ${column} would be ${bytes} bytes before compression, over ${MAX_PROPS_BYTES}; pack fewer rows`);
    this.name = "SegmentTooLargeError";
  }
}

/** One event as the compactor reads it out of staging. */
export type StagedRow = {
  /** Microseconds since the epoch. */
  readonly ts: number;
  readonly actor: ActorValue;
  /** `hashtextextended(actor_id::text, 0)` — computed by Postgres, never here. */
  readonly actorHash: bigint;
  readonly sessionId: bigint | null;
  /** Dictionary id of the event type. */
  readonly eventType: number;
  /** Dictionary id per declared dimension; a missing key or `null` is null. */
  readonly dims: Readonly<Record<string, number | null | undefined>>;
  /** Per declared measure; int8 as bigint (a number is accepted and widened), float8 as number. */
  readonly measures: Readonly<Record<string, number | bigint | null | undefined>>;
  /** JSON text, or null. */
  readonly props: string | null;
};

/** The row that goes into `<stream>_segments`. Column keys are the DDL column names. */
export type Segment = {
  readonly format: number;
  readonly tsMin: number;
  readonly tsMax: number;
  readonly n: number;
  /** Gzipped bytes per column. */
  readonly columns: Readonly<Record<string, Uint8Array>>;
  /** Inflated length per column: the bound `decode` enforces before inflating. */
  readonly rawBytes: Readonly<Record<string, number>>;
};

/** One row of `<stream>_summary`: a segment's hour × event type. */
export type SummaryRow = {
  /** Hour-aligned, microseconds. */
  readonly bucket: number;
  readonly eventType: number;
  readonly n: number;
  /** Per declared measure, in declared order: sum of the present values. */
  readonly measures: readonly (number | bigint)[];
  /** KMV sketch of the actors in this cell, sorted ascending. */
  readonly actors: readonly bigint[];
};

/**
 * One row of `<stream>_summary_dims`: the same cell split by ONE dimension's
 * value. A marginal, not a cross product: rows are bounded by the sum of the
 * dimensions' cardinalities, never their product, so six high-cardinality
 * dimensions cost a few thousand rows per segment and not one per event.
 */
export type SummaryDimRow = {
  readonly bucket: number;
  readonly eventType: number;
  /** Index into the stream's declared dimensions. */
  readonly dim: number;
  /** Dictionary id; 0 is null. */
  readonly value: number;
  readonly n: number;
  readonly measures: readonly (number | bigint)[];
  readonly actors: readonly bigint[];
};

export type Summary = { readonly base: SummaryRow[]; readonly dims: SummaryDimRow[] };

export type PackResult = { readonly segment: Segment; readonly summary: Summary };

/** What `decode` hands back. Every field is present when its column was requested. */
export type DecodedSegment = {
  readonly n: number;
  readonly ts?: Float64Array;
  readonly eventType?: Uint32Array;
  readonly actor?: Actors;
  readonly sessionId?: NullableBigints;
  readonly dims?: Readonly<Record<string, Uint32Array>>;
  readonly measures?: Readonly<Record<string, NullableBigints | NullableFloats>>;
  readonly props?: readonly (string | null)[];
};

export class SegmentFormatError extends Error {
  constructor(readonly format: number) {
    super(`litics: segment format ${format} is not readable by this build (supports ${SEGMENT_FORMAT})`);
    this.name = "SegmentFormatError";
  }
}

export class SegmentCorruptError extends Error {
  constructor(message: string) {
    super(`litics: ${message}`);
    this.name = "SegmentCorruptError";
  }
}

/** The fixed column names, in the order the DDL declares them. */
export const FIXED_COLUMNS = ["ts", "actor", "session_id", "event_type"] as const;

/** Every column a segment of this stream has, in DDL order. */
export const segmentColumns = (stream: ResolvedStream): string[] => [
  ...FIXED_COLUMNS,
  ...stream.dimensions.map((d) => d.name),
  ...stream.measures.map((m) => m.name),
  "props",
];

const isUint32 = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

const validate = (stream: ResolvedStream, rows: readonly StagedRow[]): void => {
  if (rows.length === 0) throw new RangeError("pack: a segment needs at least one row");
  const dimMax = new Map(stream.dimensions.map((d) => [d.name, d.type === "int2" ? 0x7fff : 0x7fffffff]));
  rows.forEach((row, i) => {
    if (!Number.isInteger(row.ts) || Math.abs(row.ts) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`pack: row ${i} ts ${row.ts} is not an integer number of microseconds`);
    }
    if (!isUint32(row.eventType) || row.eventType === 0) {
      throw new RangeError(`pack: row ${i} event type ${row.eventType} is not a dictionary id`);
    }
    if (typeof row.actorHash !== "bigint") throw new TypeError(`pack: row ${i} actorHash is not a bigint`);
    for (const [name, max] of dimMax) {
      const v = row.dims[name];
      if (v === null || v === undefined) continue;
      if (!isUint32(v) || v > max) throw new RangeError(`pack: row ${i} dimension ${name} = ${v} is not a dictionary id`);
    }
    for (const m of stream.measures) {
      const v = row.measures[m.name];
      if (v === null || v === undefined) continue;
      if (m.type === "float8" && typeof v !== "number") {
        throw new TypeError(`pack: row ${i} measure ${m.name} is not a number`);
      }
      if (m.type === "int8" && !(typeof v === "bigint" || Number.isInteger(v))) {
        throw new TypeError(`pack: row ${i} measure ${m.name} is not an integer`);
      }
    }
  });
};

const hourOf = (ts: number): number => Math.floor(ts / HOUR_US) * HOUR_US;

/**
 * Sort key: `ts`, then the stream's `sortBy` column, then input order. The
 * secondary key is what groups equal-type or equal-dimension events inside
 * each timestamp run so the bit-packed columns compress well.
 */
const order = (stream: ResolvedStream, rows: readonly StagedRow[]): StagedRow[] => {
  const sortDim = stream.sortBy === "event_type" ? null : stream.sortBy;
  const key = (r: StagedRow): number => (sortDim === null ? r.eventType : (r.dims[sortDim] ?? 0));
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.ts - b.row.ts || key(a.row) - key(b.row) || a.i - b.i)
    .map((x) => x.row);
};

type Cell = {
  bucket: number;
  eventType: number;
  dim: number;
  value: number;
  n: number;
  sums: (number | bigint)[];
  hashes: bigint[];
};

const summarise = (stream: ResolvedStream, sorted: readonly StagedRow[]): Summary => {
  const cells = new Map<string, Cell>();
  const touch = (bucket: number, eventType: number, dim: number, value: number, row: StagedRow): void => {
    const key = `${bucket}|${eventType}|${dim}|${value}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { bucket, eventType, dim, value, n: 0, sums: stream.measures.map((m) => (m.type === "int8" ? 0n : 0)), hashes: [] };
      cells.set(key, cell);
    }
    cell.n++;
    cell.hashes.push(row.actorHash);
    stream.measures.forEach((m, j) => {
      const v = row.measures[m.name];
      if (v === null || v === undefined) return;
      cell.sums[j] = m.type === "int8" ? (cell.sums[j] as bigint) + BigInt(v) : (cell.sums[j] as number) + Number(v);
    });
  };
  for (const row of sorted) {
    const bucket = hourOf(row.ts);
    // The base cell (dim −1), then one marginal cell per declared dimension.
    touch(bucket, row.eventType, -1, 0, row);
    stream.dimensions.forEach((d, i) => touch(bucket, row.eventType, i, row.dims[d.name] ?? 0, row));
  }
  const base: SummaryRow[] = [];
  const dims: SummaryDimRow[] = [];
  for (const c of cells.values()) {
    const actors = kmv.fromHashes(c.hashes).hashes;
    if (c.dim < 0) base.push({ bucket: c.bucket, eventType: c.eventType, n: c.n, measures: c.sums, actors });
    else dims.push({ bucket: c.bucket, eventType: c.eventType, dim: c.dim, value: c.value, n: c.n, measures: c.sums, actors });
  }
  return { base, dims };
};

/**
 * Pack staged rows into a segment and its summary. Rows may arrive in any
 * order; the segment is sorted. The input is not mutated.
 */
export const pack = (stream: ResolvedStream, rows: readonly StagedRow[]): PackResult => {
  validate(stream, rows);
  const sorted = order(stream, rows);
  const n = sorted.length;
  const tsMin = sorted[0]!.ts;
  const tsMax = sorted[n - 1]!.ts;

  const raw: Record<string, Uint8Array> = {};
  raw["ts"] = encodeDeltas(sorted.map((r) => r.ts), tsMin);
  raw["actor"] = encodeActors(sorted.map((r) => r.actor), sorted.map((r) => r.actorHash), stream.actorType);
  raw["session_id"] = encodeBigints(sorted.map((r) => r.sessionId));
  raw["event_type"] = encodeInts(sorted.map((r) => r.eventType));
  for (const d of stream.dimensions) raw[d.name] = encodeInts(sorted.map((r) => r.dims[d.name] ?? 0));
  for (const m of stream.measures) {
    raw[m.name] =
      m.type === "int8"
        ? encodeBigints(sorted.map((r) => (r.measures[m.name] == null ? null : BigInt(r.measures[m.name]!))))
        : encodeFloats(sorted.map((r) => (r.measures[m.name] == null ? null : Number(r.measures[m.name]))));
  }
  raw["props"] = encodeStrings(sorted.map((r) => (r.props === null || r.props === "{}" ? null : r.props)));
  if (raw["props"].length > MAX_PROPS_BYTES) throw new SegmentTooLargeError("props", raw["props"].length);

  const columns: Record<string, Uint8Array> = {};
  const rawBytes: Record<string, number> = {};
  for (const [name, bytes] of Object.entries(raw)) {
    columns[name] = new Uint8Array(gzipSync(bytes));
    rawBytes[name] = bytes.length;
  }

  return {
    segment: { format: SEGMENT_FORMAT, tsMin, tsMax, n, columns, rawBytes },
    summary: summarise(stream, sorted),
  };
};

const inflate = (segment: Segment, name: string): Uint8Array => {
  const packed = segment.columns[name];
  if (packed === undefined) throw new SegmentCorruptError(`segment has no column ${name}`);
  const expected = segment.rawBytes[name];
  if (!Number.isInteger(expected) || expected! < 0 || expected! > MAX_INFLATED_BYTES) {
    throw new SegmentCorruptError(`column ${name} claims ${expected} inflated bytes`);
  }
  let out: Uint8Array;
  try {
    out = gunzipSync(packed, { maxOutputLength: Math.max(1, expected!) });
  } catch (cause) {
    throw new SegmentCorruptError(`column ${name} does not inflate: ${String(cause)}`);
  }
  if (out.length !== expected) {
    throw new SegmentCorruptError(`column ${name} inflated to ${out.length} bytes, expected ${expected}`);
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.length);
};

/**
 * Decode the requested columns (DDL names; default all). Columns not asked
 * for are not inflated — a count needs `ts` alone, a funnel three columns.
 */
export const decode = (
  stream: ResolvedStream,
  segment: Segment,
  columns: readonly string[] = segmentColumns(stream),
): DecodedSegment => {
  if (segment.format !== SEGMENT_FORMAT) throw new SegmentFormatError(segment.format);
  const n = segment.n;
  if (!Number.isInteger(n) || n < 1) throw new SegmentCorruptError(`segment claims n = ${n}`);
  const want = new Set(columns);
  const dimTypes = new Map(stream.dimensions.map((d) => [d.name, d.type]));
  const measureTypes = new Map(stream.measures.map((m) => [m.name, m.type]));
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
  try {
    for (const name of want) {
      if (name === "ts") out.ts = decodeDeltas(inflate(segment, name), n, segment.tsMin);
      else if (name === "actor") out.actor = decodeActors(inflate(segment, name), n, stream.actorType);
      else if (name === "session_id") out.sessionId = decodeBigints(inflate(segment, name), n);
      else if (name === "event_type") out.eventType = decodeInts(inflate(segment, name), n);
      else if (name === "props") out.props = decodeStrings(inflate(segment, name), n);
      else if (dimTypes.has(name)) (out.dims ??= {})[name] = decodeInts(inflate(segment, name), n);
      else if (measureTypes.has(name)) {
        (out.measures ??= {})[name] =
          measureTypes.get(name) === "int8"
            ? decodeBigints(inflate(segment, name), n)
            : decodeFloats(inflate(segment, name), n);
      } else throw new RangeError(`decode: stream ${stream.name} has no column ${name}`);
    }
  } catch (cause) {
    if (cause instanceof SegmentCorruptError || !(cause instanceof RangeError)) throw cause;
    throw new SegmentCorruptError(cause.message);
  }
  if (out.ts && out.ts[n - 1] !== segment.tsMax) {
    throw new SegmentCorruptError(`segment ts_max ${segment.tsMax} disagrees with its last event ${out.ts[n - 1]}`);
  }
  return out;
};

/**
 * The inverse of `pack` for a fully decoded segment: the rows, in segment
 * order, ready to be packed again. This is how merge works — decode a run
 * of small segments, concatenate, pack once — and it is why every column
 * must be present.
 */
export const rowsOf = (stream: ResolvedStream, decoded: DecodedSegment): StagedRow[] => {
  const { n } = decoded;
  const ts = decoded.ts;
  const et = decoded.eventType;
  const actor = decoded.actor;
  const session = decoded.sessionId;
  const props = decoded.props;
  if (!ts || !et || !actor || !session || !props) throw new RangeError("rowsOf: decode every column first");
  for (const d of stream.dimensions) if (!decoded.dims?.[d.name]) throw new RangeError(`rowsOf: dimension ${d.name} not decoded`);
  for (const m of stream.measures) if (!decoded.measures?.[m.name]) throw new RangeError(`rowsOf: measure ${m.name} not decoded`);
  const rows: StagedRow[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const dims: Record<string, number | null> = {};
    for (const d of stream.dimensions) {
      const v = decoded.dims![d.name]![i]!;
      dims[d.name] = v === 0 ? null : v;
    }
    const measures: Record<string, number | bigint | null> = {};
    for (const m of stream.measures) {
      const col = decoded.measures![m.name]!;
      measures[m.name] = col.present[i] ? (col.values[i] as number | bigint) : null;
    }
    rows[i] = {
      ts: ts[i]!,
      actor: actor.values[actor.index[i]!]!,
      actorHash: actor.hashes[actor.index[i]!]!,
      sessionId: session.present[i] ? session.values[i]! : null,
      eventType: et[i]!,
      dims,
      measures,
      props: props[i]!,
    };
  }
  return rows;
};
