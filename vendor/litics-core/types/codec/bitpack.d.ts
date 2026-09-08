/**
 * Fixed-width bit packing for small non-negative integers.
 *
 * A dictionary-encoded dimension with forty distinct values needs six bits
 * per event, not sixteen or thirty-two. Packing `n` values at `bits` each
 * costs `ceil(n * bits / 8)` bytes before gzip, and gzip then finds the
 * repetition a sorted column has. This is where "20,000 bytes to 242" comes
 * from.
 *
 * Also the presence bitmap: one bit per event saying whether a nullable
 * column has a value there, so the packed values below it hold only the
 * events that do. `bits = 1` is that bitmap.
 */
/** Bits needed to represent every value in `[0, max]`. `max = 0` needs zero. */
export declare const bitsFor: (max: number) => number;
/**
 * Pack `values` at `bits` per value, least-significant-bit first within each
 * byte. `bits = 0` packs to zero bytes and unpacks to all zeros — the
 * all-same column costs nothing.
 */
export declare const pack: (values: ArrayLike<number>, bits: number) => Uint8Array;
/** Inverse of `pack`. `count` says how many values to read; the buffer's length cannot. */
export declare const unpack: (bytes: Uint8Array, bits: number, count: number) => Uint32Array;
/** A presence bitmap: bit `i` set when `present[i]`. */
export declare const packBitmap: (present: ArrayLike<boolean>) => Uint8Array;
export declare const unpackBitmap: (bytes: Uint8Array, count: number) => Uint8Array;
