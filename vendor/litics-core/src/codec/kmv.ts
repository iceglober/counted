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

export const KMV_K = 2048;

const TWO_63 = 2n ** 63n;
const TWO_64 = 2n ** 64n;

/** Sorted ascending, at most `k` entries, no duplicates. */
export type Sketch = { readonly k: number; readonly hashes: readonly bigint[] };

export const empty = (k: number = KMV_K): Sketch => ({ k, hashes: [] });

/** Binary search for `value` in a sorted array. Returns the insertion index and whether it was found. */
const locate = (hashes: readonly bigint[], value: bigint): { index: number; found: boolean } => {
  let lo = 0;
  let hi = hashes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const at = hashes[mid]!;
    if (at === value) return { index: mid, found: true };
    if (at < value) lo = mid + 1;
    else hi = mid;
  }
  return { index: lo, found: false };
};

/** Add one hash. Returns the same sketch when nothing changes. */
export const add = (sketch: Sketch, hash: bigint): Sketch => {
  const { k, hashes } = sketch;
  if (hashes.length === k && hash >= hashes[k - 1]!) return sketch;
  const { index, found } = locate(hashes, hash);
  if (found) return sketch;
  const next = hashes.slice();
  next.splice(index, 0, hash);
  if (next.length > k) next.length = k;
  return { k, hashes: next };
};

/** Build a sketch from many hashes at once — sort once, dedupe, truncate. */
export const fromHashes = (hashes: Iterable<bigint>, k: number = KMV_K): Sketch => {
  const sorted = Array.from(hashes).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: bigint[] = [];
  let last: bigint | undefined;
  for (const h of sorted) {
    if (h === last) continue;
    out.push(h);
    last = h;
    if (out.length === k) break;
  }
  return { k, hashes: out };
};

/** Merge two sketches. Both must share `k`. */
export const union = (a: Sketch, b: Sketch): Sketch => {
  if (a.k !== b.k) throw new RangeError(`kmv.union: k differs (${a.k} vs ${b.k})`);
  if (b.hashes.length === 0) return a;
  if (a.hashes.length === 0) return b;
  const k = a.k;
  const out: bigint[] = [];
  let i = 0;
  let j = 0;
  while (out.length < k && (i < a.hashes.length || j < b.hashes.length)) {
    const x = a.hashes[i];
    const y = b.hashes[j];
    if (y === undefined || (x !== undefined && x < y)) {
      out.push(x!);
      i++;
    } else if (x === undefined || y < x) {
      out.push(y);
      j++;
    } else {
      out.push(x);
      i++;
      j++;
    }
  }
  return { k, hashes: out };
};

/** Map a signed int64 hash onto `[0, 1)`. */
const unit = (hash: bigint): number => Number(hash + TWO_63) / Number(TWO_64);

/**
 * The distinct count: exact while the sketch is not full, estimated after.
 * Always a non-negative integer.
 */
export const estimate = (sketch: Sketch): number => {
  const { k, hashes } = sketch;
  if (hashes.length < k) return hashes.length;
  const uk = unit(hashes[k - 1]!);
  if (uk <= 0) return k;
  return Math.max(k, Math.round((k - 1) / uk));
};

/** True when `estimate` is a count rather than an estimate. */
export const isExact = (sketch: Sketch): boolean => sketch.hashes.length < sketch.k;
