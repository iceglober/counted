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

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** A growable byte sink. Callers append, then take the bytes once. */
export class ByteWriter {
  #buffer: Uint8Array;
  #length = 0;

  constructor(initialCapacity = 1024) {
    this.#buffer = new Uint8Array(initialCapacity);
  }

  get length(): number {
    return this.#length;
  }

  #ensure(extra: number): void {
    const needed = this.#length + extra;
    if (needed <= this.#buffer.length) return;
    let capacity = this.#buffer.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = grown;
  }

  byte(value: number): void {
    this.#ensure(1);
    this.#buffer[this.#length++] = value & 0xff;
  }

  bytes(value: Uint8Array): void {
    this.#ensure(value.length);
    this.#buffer.set(value, this.#length);
    this.#length += value.length;
  }

  /** Unsigned, `0 <= value <= 2^53 - 1`. */
  uvarint(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE) {
      throw new RangeError(`uvarint: ${value} is not an integer in [0, 2^53)`);
    }
    // Above 2^31 the bitwise operators would wrap, so peel bytes with
    // arithmetic instead. Each step is exact below 2^53.
    while (value >= 0x80) {
      this.byte((value % 0x80) | 0x80);
      value = Math.floor(value / 0x80);
    }
    this.byte(value);
  }

  /** Signed, zigzag-encoded, `|value| < 2^52`. */
  svarint(value: number): void {
    if (!Number.isInteger(value) || Math.abs(value) >= 2 ** 52) {
      throw new RangeError(`svarint: ${value} is not an integer with |value| < 2^52`);
    }
    this.uvarint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  /** Unsigned bigint, any size. */
  ubigvarint(value: bigint): void {
    if (value < 0n) throw new RangeError(`ubigvarint: ${value} is negative`);
    while (value >= 0x80n) {
      this.byte(Number(value & 0x7fn) | 0x80);
      value >>= 7n;
    }
    this.byte(Number(value));
  }

  /** Signed bigint, zigzag-encoded, any size. */
  sbigvarint(value: bigint): void {
    this.ubigvarint(value >= 0n ? value << 1n : (-value << 1n) - 1n);
  }

  /** The bytes written so far. A copy, so the writer can keep going. */
  toBytes(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }
}

/** A cursor over bytes. Every read advances; reading past the end throws. */
export class ByteReader {
  #offset = 0;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.#bytes.length - this.#offset;
  }

  byte(): number {
    if (this.#offset >= this.#bytes.length) throw new RangeError("read past end of buffer");
    return this.#bytes[this.#offset++]!;
  }

  bytes(length: number): Uint8Array {
    if (this.#offset + length > this.#bytes.length) throw new RangeError("read past end of buffer");
    const out = this.#bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return out;
  }

  uvarint(): number {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      value += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) {
        if (value > MAX_SAFE) throw new RangeError("uvarint exceeds 2^53");
        return value;
      }
      scale *= 0x80;
    }
    throw new RangeError("uvarint longer than 8 bytes cannot fit in a number");
  }

  svarint(): number {
    const raw = this.uvarint();
    // raw is even for non-negative originals, odd for negative. Exact below 2^53.
    return raw % 2 === 0 ? raw / 2 : -(raw + 1) / 2;
  }

  ubigvarint(): bigint {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      const b = this.byte();
      value |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
      shift += 7n;
      if (shift > 70n) throw new RangeError("bigvarint longer than 10 bytes");
    }
  }

  sbigvarint(): bigint {
    const raw = this.ubigvarint();
    return (raw & 1n) === 0n ? raw >> 1n : -((raw + 1n) >> 1n);
  }
}
