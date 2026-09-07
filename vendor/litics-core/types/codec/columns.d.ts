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
/** `[uvarint min][byte bits][bit-packed (v - min)]`. All-same costs two bytes. */
export declare const encodeInts: (values: ArrayLike<number>) => Uint8Array;
export declare const decodeInts: (bytes: Uint8Array, n: number) => Uint32Array;
/** Gaps from `base`, then from each previous value. Values must not decrease. */
export declare const encodeDeltas: (values: ArrayLike<number>, base: number) => Uint8Array;
export declare const decodeDeltas: (bytes: Uint8Array, n: number, base: number) => Float64Array;
export type NullableBigints = {
    readonly present: Uint8Array;
    readonly values: BigInt64Array;
};
export type NullableFloats = {
    readonly present: Uint8Array;
    readonly values: Float64Array;
};
/** `[presence bitmap][zigzag varint per present value]`. Absent values decode to 0n. */
export declare const encodeBigints: (values: readonly (bigint | null)[]) => Uint8Array;
export declare const decodeBigints: (bytes: Uint8Array, n: number) => NullableBigints;
/** `[presence bitmap][little-endian float64 per present value]`. Absent values decode to 0. */
export declare const encodeFloats: (values: readonly (number | null)[]) => Uint8Array;
export declare const decodeFloats: (bytes: Uint8Array, n: number) => NullableFloats;
/** `[uvarint length + 1, or 0 for null][utf-8 bytes]` per value. */
export declare const encodeStrings: (values: readonly (string | null)[]) => Uint8Array;
export declare const decodeStrings: (bytes: Uint8Array, n: number) => (string | null)[];
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
export declare const encodeActors: (values: readonly ActorValue[], hashes: readonly bigint[], type: ActorType) => Uint8Array;
export declare const decodeActors: (bytes: Uint8Array, n: number, type: ActorType) => Actors;
