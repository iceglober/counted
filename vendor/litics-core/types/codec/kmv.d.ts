/**
 * KMV — k minimum values — a sketch for counting distinct things.
 *
 * Hash every actor to a 64-bit number. Hashes are uniform, so if you have
 * seen `n` distinct actors the smallest hash sits near `1/(n+1)` of the way
 * along the line, and the k-th smallest near `k/(n+1)`. Keep the k smallest
 * and invert: `n ≈ (k − 1) / u_k` where `u_k` is the k-th smallest mapped to
 * `[0, 1)`. Error is about `1/√k`; at k = 2048 that is ~2%, and it was
 * measured at 0.35% on a 40,000-actor union.
 *
 * Below k distinct actors the sketch *is* the set of hashes, so the count is
 * exact — the estimator returns the length. A per-hour, per-event-type
 * summary cell rarely reaches k, so most cells are exact and only wide
 * unions estimate.
 *
 * Two sketches merge by pooling and keeping the k smallest. A repeat actor
 * hashes to a value already present and collapses. That is what lets a
 * workspace's uniques come from its projects' sketches without double
 * counting, and it is why this exists instead of `count(DISTINCT)`.
 *
 * Hashes are the signed int64 Postgres produces from `hashtextextended`,
 * stored sorted ascending as signed values. Signed order is a uniform
 * permutation of the unsigned line, so "smallest k signed" is a valid
 * sample; the estimator maps the k-th value back to `[0, 1)` by offsetting
 * the sign.
 */
export declare const KMV_K = 2048;
/** Sorted ascending, at most `k` entries, no duplicates. */
export type Sketch = {
    readonly k: number;
    readonly hashes: readonly bigint[];
};
export declare const empty: (k?: number) => Sketch;
/** Add one hash. Returns the same sketch when nothing changes. */
export declare const add: (sketch: Sketch, hash: bigint) => Sketch;
/** Build a sketch from many hashes at once — sort once, dedupe, truncate. */
export declare const fromHashes: (hashes: Iterable<bigint>, k?: number) => Sketch;
/** Merge two sketches. Both must share `k`. */
export declare const union: (a: Sketch, b: Sketch) => Sketch;
/**
 * The distinct count: exact while the sketch is not full, estimated after.
 * Always a non-negative integer.
 */
export declare const estimate: (sketch: Sketch) => number;
/** True when `estimate` is a count rather than an estimate. */
export declare const isExact: (sketch: Sketch) => boolean;
