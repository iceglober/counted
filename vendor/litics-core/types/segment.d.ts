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
import type { ResolvedStream } from "./config.js";
import { type ActorType, type ActorValue, type Actors, type NullableBigints, type NullableFloats } from "./codec/columns.js";
export type { ActorType, ActorValue, Actors, NullableBigints, NullableFloats };
/** The on-disk layout this code writes. Bump when any column's bytes change meaning. */
export declare const SEGMENT_FORMAT = 1;
/** Microseconds in an hour: the summary's bucket width. */
export declare const HOUR_US = 3600000000;
/** No column may inflate past this. A segment holds ~10k events; 256 MiB is a bomb, not data. */
export declare const MAX_INFLATED_BYTES: number;
/**
 * The packer refuses a batch whose props alone would exceed this before
 * compression; the compactor then packs fewer rows. Keeps one enormous
 * property bag from producing a segment every read of that hour must inflate.
 */
export declare const MAX_PROPS_BYTES: number;
export declare class SegmentTooLargeError extends RangeError {
    readonly column: string;
    readonly bytes: number;
    constructor(column: string, bytes: number);
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
export type Summary = {
    readonly base: SummaryRow[];
    readonly dims: SummaryDimRow[];
};
export type PackResult = {
    readonly segment: Segment;
    readonly summary: Summary;
};
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
export declare class SegmentFormatError extends Error {
    readonly format: number;
    constructor(format: number);
}
export declare class SegmentCorruptError extends Error {
    constructor(message: string);
}
/** The fixed column names, in the order the DDL declares them. */
export declare const FIXED_COLUMNS: readonly ["ts", "actor", "session_id", "event_type"];
/** Every column a segment of this stream has, in DDL order. */
export declare const segmentColumns: (stream: ResolvedStream) => string[];
/**
 * Pack staged rows into a segment and its summary. Rows may arrive in any
 * order; the segment is sorted. The input is not mutated.
 */
export declare const pack: (stream: ResolvedStream, rows: readonly StagedRow[]) => PackResult;
/**
 * Decode the requested columns (DDL names; default all). Columns not asked
 * for are not inflated — a count needs `ts` alone, a funnel three columns.
 */
export declare const decode: (stream: ResolvedStream, segment: Segment, columns?: readonly string[]) => DecodedSegment;
/**
 * The inverse of `pack` for a fully decoded segment: the rows, in segment
 * order, ready to be packed again. This is how merge works — decode a run
 * of small segments, concatenate, pack once — and it is why every column
 * must be present.
 */
export declare const rowsOf: (stream: ResolvedStream, decoded: DecodedSegment) => StagedRow[];
