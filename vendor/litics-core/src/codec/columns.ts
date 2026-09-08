/**
 * Column encoders — one per column shape a segment can hold.
 *
 * Each encoder turns one column of `n` values into bytes and back. None of
 * them writes `n`: the segment row carries it, and every column of a segment
 * has the same `n`. None of them compresses: `segment.ts` gzips the result.
 * What they do is arrange the bytes so gzip has something to find — a sorted
 * timestamp column becomes a run of small deltas, a dimension with forty
 * values becomes six bits per event, an actor repeated a hundred times
 * becomes one dictionary entry and a hundred small indexes.
 *
 * Shapes:
 * - ints      non-null uint32 (event types, dimension ids with 0 = null)
 * - deltas    non-decreasing integers as gaps from a base (timestamps)
 * - bigints   nullable int64 (session ids, int8 measures)
 * - floats    nullable float64 (float8 measures)
 * - strings   nullable UTF-8 (props as JSON text)
 * - actors    a per-column dictionary of (value, hash), then indexes
 */

import { bitsFor, pack as packBits, packBitmap, unpack as unpackBits, unpackBitmap } from "./bitpack.js";
import { ByteReader, ByteWriter } from "./varint.js";

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

/** `[uvarint min][byte bits][bit-packed (v - min)]`. All-same costs two bytes. */
export const encodeInts = (values: ArrayLike<number>): Uint8Array => {
  const n = values.length;
  let min = 0;
  let max = 0;
  if (n > 0) {
    min = values[0]!;
    max = values[0]!;
    for (let i = 1; i < n; i++) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isInteger(min) || min < 0 || max > 0xffffffff) {
    throw new RangeError(`encodeInts: values must be integers in [0, 2^32)`);
  }
  const bits = bitsFor(max - min);
  const shifted = new Uint32Array(n);
  for (let i = 0; i < n; i++) shifted[i] = values[i]! - min;
  const w = new ByteWriter(8 + Math.ceil((n * bits) / 8));
  w.uvarint(min);
  w.byte(bits);
  w.bytes(packBits(shifted, bits));
  return w.toBytes();
};

export const decodeInts = (bytes: Uint8Array, n: number): Uint32Array => {
  const r = new ByteReader(bytes);
  const min = r.uvarint();
  const bits = r.byte();
  const out = unpackBits(r.bytes(Math.ceil((n * bits) / 8)), bits, n);
  if (min !== 0) for (let i = 0; i < n; i++) out[i] = out[i]! + min;
  return out;
};

/** Gaps from `base`, then from each previous value. Values must not decrease. */
export const encodeDeltas = (values: ArrayLike<number>, base: number): Uint8Array => {
  const n = values.length;
  const w = new ByteWriter(n + 8);
  let prev = base;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    const gap = v - prev;
    if (!Number.isInteger(gap) || gap < 0) {
      throw new RangeError(`encodeDeltas: value ${v} at ${i} precedes ${prev}`);
    }
    w.uvarint(gap);
    prev = v;
  }
  return w.toBytes();
};

export const decodeDeltas = (bytes: Uint8Array, n: number, base: number): Float64Array => {
  const r = new ByteReader(bytes);
  const out = new Float64Array(n);
  let prev = base;
  for (let i = 0; i < n; i++) {
    prev += r.uvarint();
    out[i] = prev;
  }
  return out;
};

export type NullableBigints = { readonly present: Uint8Array; readonly values: BigInt64Array };
export type NullableFloats = { readonly present: Uint8Array; readonly values: Float64Array };

/** `[presence bitmap][zigzag varint per present value]`. Absent values decode to 0n. */
export const encodeBigints = (values: readonly (bigint | null)[]): Uint8Array => {
  const n = values.length;
  const w = new ByteWriter(n * 2 + 8);
  w.bytes(packBitmap(values.map((v) => v !== null)));
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v !== null) w.sbigvarint(v);
  }
  return w.toBytes();
};

export const decodeBigints = (bytes: Uint8Array, n: number): NullableBigints => {
  const r = new ByteReader(bytes);
  const present = unpackBitmap(r.bytes(Math.ceil(n / 8)), n);
  const values = new BigInt64Array(n);
  for (let i = 0; i < n; i++) if (present[i]) values[i] = r.sbigvarint();
  return { present, values };
};

/** `[presence bitmap][little-endian float64 per present value]`. Absent values decode to 0. */
export const encodeFloats = (values: readonly (number | null)[]): Uint8Array => {
  const n = values.length;
  const bitmap = packBitmap(values.map((v) => v !== null));
  let count = 0;
  for (const v of values) if (v !== null) count++;
  const out = new Uint8Array(bitmap.length + count * 8);
  out.set(bitmap);
  const view = new DataView(out.buffer, out.byteOffset);
  let at = bitmap.length;
  for (const v of values) {
    if (v === null) continue;
    view.setFloat64(at, v, true);
    at += 8;
  }
  return out;
};

export const decodeFloats = (bytes: Uint8Array, n: number): NullableFloats => {
  const bitmapBytes = Math.ceil(n / 8);
  const present = unpackBitmap(bytes.subarray(0, bitmapBytes), n);
  const values = new Float64Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = bitmapBytes;
  for (let i = 0; i < n; i++) {
    if (!present[i]) continue;
    if (at + 8 > bytes.byteLength) throw new RangeError("decodeFloats: read past end of buffer");
    values[i] = view.getFloat64(at, true);
    at += 8;
  }
  return { present, values };
};

/** `[uvarint length + 1, or 0 for null][utf-8 bytes]` per value. */
export const encodeStrings = (values: readonly (string | null)[]): Uint8Array => {
  const w = new ByteWriter(values.length * 2 + 8);
  for (const v of values) {
    if (v === null) {
      w.byte(0);
      continue;
    }
    const bytes = utf8.encode(v);
    w.uvarint(bytes.length + 1);
    w.bytes(bytes);
  }
  return w.toBytes();
};

export const decodeStrings = (bytes: Uint8Array, n: number): (string | null)[] => {
  const r = new ByteReader(bytes);
  const out: (string | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const tag = r.uvarint();
    out[i] = tag === 0 ? null : fromUtf8.decode(r.bytes(tag - 1));
  }
  return out;
};

export type ActorType = "int8" | "uuid" | "text";
export type ActorValue = string | bigint;
export type Actors = {
  /** Per event: which dictionary entry. */
  readonly index: Uint32Array;
  /** Per dictionary entry: the actor's 64-bit hash, as Postgres computed it. */
  readonly hashes: BigInt64Array;
  /** Per dictionary entry: the actor id itself. */
  readonly values: readonly ActorValue[];
};

/**
 * `[uvarint distinct][per entry: sbigvarint hash, value][byte bits][packed index]`.
 * Entries appear in order of first use, so a sorted column's dictionary is
 * itself roughly sorted. The same actor must carry the same hash everywhere
 * in the column; that is Postgres' promise and this checks it.
 */
export const encodeActors = (
  values: readonly ActorValue[],
  hashes: readonly bigint[],
  type: ActorType,
): Uint8Array => {
  const n = values.length;
  if (hashes.length !== n) throw new RangeError("encodeActors: values and hashes differ in length");
  const slot = new Map<string, number>();
  const entries: { value: ActorValue; hash: bigint }[] = [];
  const index = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const value = values[i]!;
    const key = typeof value === "bigint" ? `b${value}` : `s${value}`;
    let at = slot.get(key);
    if (at === undefined) {
      at = entries.length;
      slot.set(key, at);
      entries.push({ value, hash: hashes[i]! });
    } else if (entries[at]!.hash !== hashes[i]) {
      throw new RangeError(`encodeActors: actor ${String(value)} carries two hashes`);
    }
    index[i] = at;
  }
  const w = new ByteWriter(n * 2 + entries.length * 24);
  w.uvarint(entries.length);
  for (const { value, hash } of entries) {
    w.sbigvarint(hash);
    if (type === "int8") {
      if (typeof value !== "bigint") throw new TypeError(`encodeActors: int8 actor ${String(value)} is not a bigint`);
      w.sbigvarint(value);
    } else {
      if (typeof value !== "string") throw new TypeError(`encodeActors: ${type} actor ${String(value)} is not a string`);
      const bytes = utf8.encode(value);
      w.uvarint(bytes.length);
      w.bytes(bytes);
    }
  }
  const bits = bitsFor(Math.max(0, entries.length - 1));
  w.byte(bits);
  w.bytes(packBits(index, bits));
  return w.toBytes();
};

export const decodeActors = (bytes: Uint8Array, n: number, type: ActorType): Actors => {
  const r = new ByteReader(bytes);
  const distinct = r.uvarint();
  const hashes = new BigInt64Array(distinct);
  const values: ActorValue[] = new Array(distinct);
  for (let i = 0; i < distinct; i++) {
    hashes[i] = r.sbigvarint();
    values[i] = type === "int8" ? r.sbigvarint() : fromUtf8.decode(r.bytes(r.uvarint()));
  }
  const bits = r.byte();
  const index = unpackBits(r.bytes(Math.ceil((n * bits) / 8)), bits, n);
  for (let i = 0; i < n; i++) {
    if (index[i]! >= distinct) throw new RangeError(`decodeActors: index ${index[i]} at ${i} is outside the dictionary`);
  }
  return { index, hashes, values };
};
