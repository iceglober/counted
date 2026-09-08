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
export const bitsFor = (max: number): number => {
  if (!Number.isInteger(max) || max < 0) throw new RangeError(`bitsFor: ${max} is not a non-negative integer`);
  if (max === 0) return 0;
  if (max > 0xffffffff) throw new RangeError(`bitsFor: ${max} exceeds 32 bits`);
  return 32 - Math.clz32(max);
};

/**
 * Pack `values` at `bits` per value, least-significant-bit first within each
 * byte. `bits = 0` packs to zero bytes and unpacks to all zeros — the
 * all-same column costs nothing.
 */
export const pack = (values: ArrayLike<number>, bits: number): Uint8Array => {
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    throw new RangeError(`pack: bits must be an integer in [0, 32], got ${bits}`);
  }
  const n = values.length;
  if (bits === 0) return new Uint8Array(0);
  const out = new Uint8Array(Math.ceil((n * bits) / 8));
  // Arithmetic, not `1 << bits`: at 31 bits the shift goes negative.
  const limit = 2 ** bits - 1;
  let bitPos = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (!Number.isInteger(v) || v < 0 || v > limit) {
      throw new RangeError(`pack: value ${v} at index ${i} does not fit in ${bits} bits`);
    }
    // Write `bits` bits of v starting at bitPos, spilling across bytes.
    let remaining = bits;
    let value = v;
    while (remaining > 0) {
      const byteIndex = bitPos >>> 3;
      const bitOffset = bitPos & 7;
      const room = 8 - bitOffset;
      const take = Math.min(room, remaining);
      const mask = take === 32 ? 0xffffffff : (1 << take) - 1;
      out[byteIndex] = (out[byteIndex]! | ((value & mask) << bitOffset)) & 0xff;
      // `>>>` on a value that may exceed 2^31 when bits = 32: shift via division.
      value = take === 32 ? 0 : Math.floor(value / 2 ** take);
      bitPos += take;
      remaining -= take;
    }
  }
  return out;
};

/** Inverse of `pack`. `count` says how many values to read; the buffer's length cannot. */
export const unpack = (bytes: Uint8Array, bits: number, count: number): Uint32Array => {
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    throw new RangeError(`unpack: bits must be an integer in [0, 32], got ${bits}`);
  }
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`unpack: bad count ${count}`);
  const out = new Uint32Array(count);
  if (bits === 0) return out;
  if (bytes.length * 8 < count * bits) {
    throw new RangeError(`unpack: ${bytes.length} bytes cannot hold ${count} values of ${bits} bits`);
  }
  let bitPos = 0;
  for (let i = 0; i < count; i++) {
    let remaining = bits;
    let value = 0;
    let shift = 0;
    while (remaining > 0) {
      const byteIndex = bitPos >>> 3;
      const bitOffset = bitPos & 7;
      const room = 8 - bitOffset;
      const take = Math.min(room, remaining);
      const chunk = (bytes[byteIndex]! >>> bitOffset) & ((1 << take) - 1);
      value += chunk * 2 ** shift;
      shift += take;
      bitPos += take;
      remaining -= take;
    }
    out[i] = value;
  }
  return out;
};

/** A presence bitmap: bit `i` set when `present[i]`. */
export const packBitmap = (present: ArrayLike<boolean>): Uint8Array => {
  const out = new Uint8Array(Math.ceil(present.length / 8));
  for (let i = 0; i < present.length; i++) {
    if (present[i]) out[i >>> 3] = out[i >>> 3]! | (1 << (i & 7));
  }
  return out;
};

export const unpackBitmap = (bytes: Uint8Array, count: number): Uint8Array => {
  if (bytes.length * 8 < count) throw new RangeError(`unpackBitmap: ${bytes.length} bytes cannot hold ${count} bits`);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = (bytes[i >>> 3]! >>> (i & 7)) & 1;
  return out;
};
