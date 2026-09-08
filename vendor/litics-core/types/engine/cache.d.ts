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
export declare class SegmentCache {
    #private;
    readonly maxBytes: number;
    hits: number;
    misses: number;
    constructor(maxBytes: number);
    get bytes(): number;
    get size(): number;
    /** The cached columns of a segment, or which of `columns` are missing. */
    lookup(segmentId: number, format: number, columns: readonly string[]): {
        have: Map<string, DecodedColumn>;
        missing: string[];
    };
    store(segmentId: number, format: number, decoded: DecodedSegment, dims: readonly string[], measures: readonly string[]): void;
    clear(): void;
}
/** Assemble a DecodedSegment view from cached columns. */
export declare const fromColumns: (n: number, columns: Map<string, DecodedColumn>, dims: readonly string[], measures: readonly string[]) => DecodedSegment;
