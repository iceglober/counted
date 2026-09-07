/**
 * Variable-length integers, the way every columnar format writes them.
 *
 * Small numbers take one byte, and most numbers in a segment are small: a
 * timestamp is stored as its distance from the previous one, a dictionary id
 * is a few thousand at most, a measure is whatever it is. LEB128 puts seven
 * payload bits in each byte and uses the eighth to say "more follows".
 *
 * Two families. `number` for values that fit in 53 bits — every timestamp
 * delta, every count, every id — because JavaScript arithmetic on them is
 * exact and fast. `bigint` for int8 columns (`session_id`, int8 measures)
 * whose values may not.
 *
 * Signed values go through zigzag first, which folds the sign into the low
 * bit so small negatives stay small: -1 → 1, 1 → 2, -2 → 3. Without it a -1
 * is nine bytes of 0xFF.
 */
/** A growable byte sink. Callers append, then take the bytes once. */
export declare class ByteWriter {
    #private;
    constructor(initialCapacity?: number);
    get length(): number;
    byte(value: number): void;
    bytes(value: Uint8Array): void;
    /** Unsigned, `0 <= value <= 2^53 - 1`. */
    uvarint(value: number): void;
    /** Signed, zigzag-encoded, `|value| < 2^52`. */
    svarint(value: number): void;
    /** Unsigned bigint, any size. */
    ubigvarint(value: bigint): void;
    /** Signed bigint, zigzag-encoded, any size. */
    sbigvarint(value: bigint): void;
    /** The bytes written so far. A copy, so the writer can keep going. */
    toBytes(): Uint8Array;
}
/** A cursor over bytes. Every read advances; reading past the end throws. */
export declare class ByteReader {
    #private;
    constructor(bytes: Uint8Array);
    get offset(): number;
    get remaining(): number;
    byte(): number;
    bytes(length: number): Uint8Array;
    uvarint(): number;
    svarint(): number;
    ubigvarint(): bigint;
    sbigvarint(): bigint;
}
