/**
 * Id generation.
 *
 * v3 mints UUIDv7 rather than v4. Both are 128 bits and neither is guessable,
 * but a v7 embeds its creation time in the leading 48 bits, so ids sort in
 * creation order. That matters at the storage layer: a v4 primary key scatters
 * inserts across the whole B-tree and every page is a random write, while a v7
 * appends. It also means `ORDER BY id` is `ORDER BY created_at` for free,
 * which is the ordering nearly every list in this product wants.
 *
 * A v7 is NOT a secret and must never be used as one. It leaks the time it was
 * made and it is sequential; share tokens and key secrets come from
 * `randomToken`.
 */

import { Instant } from "@counted/kernel";
import type { Clock, IdGenerator } from "@counted/kernel/ports";
import { randomBytes, randomInt } from "./random";
import { systemClock } from "./clock";

const VERSION_7 = 0x70;
const VARIANT_RFC = 0x80;
/** `rand_a` is 12 bits, so the within-millisecond counter tops out here. */
const MAX_COUNTER = 0xfff;

const hex = (bytes: Uint8Array): string => {
  const s = Buffer.from(bytes).toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

/**
 * A UUIDv7 generator with a monotonic counter.
 *
 * Two ids minted in the same millisecond must still sort in the order they
 * were minted, or the sortability that is the entire reason for choosing v7
 * evaporates at exactly the moment it matters — a burst. RFC 9562's
 * "monotonic random" method covers it: seed the 12-bit `rand_a` field with a
 * random value in the bottom half when the millisecond advances, then
 * increment it for each id inside that millisecond.
 *
 * Two edge cases, both handled rather than assumed away:
 *
 * - **Counter exhaustion.** More than ~2048 ids in one millisecond overflows
 *   `rand_a`. Borrowing a millisecond from the future keeps the sequence
 *   strictly increasing; the alternative — wrapping — silently emits an id
 *   that sorts *before* the one issued a microsecond earlier.
 * - **The clock going backwards.** NTP steps, VM migrations and leap-second
 *   smearing all do it. Reusing the last observed millisecond means the ids
 *   stay ordered even though the wall clock did not.
 */
export const uuidV7Generator = (clock: Clock = systemClock): IdGenerator => {
  let lastMillis = -1;
  // Seeded in the bottom half so there is always headroom to count upward.
  let counter = 0;

  return {
    next(): string {
      const observed = Instant.toEpochMillis(clock.now());

      if (observed > lastMillis) {
        lastMillis = observed;
        counter = randomInt(MAX_COUNTER >> 1);
      } else {
        counter += 1;
        if (counter > MAX_COUNTER) {
          lastMillis += 1;
          counter = randomInt(MAX_COUNTER >> 1);
        }
      }

      const bytes = randomBytes(16);
      const millis = lastMillis;

      // 48-bit big-endian timestamp. Written in two halves because a 48-bit
      // integer does not fit a bitwise operation in JavaScript, which coerces
      // to 32 bits and would silently truncate the top 16.
      bytes.writeUIntBE(Math.floor(millis / 0x100000000), 0, 2);
      bytes.writeUInt32BE(millis >>> 0, 2);

      bytes[6] = VERSION_7 | (counter >> 8);
      bytes[7] = counter & 0xff;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | VARIANT_RFC;

      return hex(bytes);
    },
  };
};

/**
 * Ids that are `<prefix>1`, `<prefix>2`, … — for tests, and only for tests.
 *
 * A test that asserts on a generated id needs to know what it will be. Naming
 * it "sequential" rather than "fake" is deliberate: it is not a stub of the
 * real thing, it is a different, predictable strategy, and using it in
 * production would make every id guessable.
 */
export const sequentialIdGenerator = (prefix = "id-"): IdGenerator => {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${prefix}${n}`;
    },
  };
};

/** Prefix every id a generator mints. Useful for reading a log at a glance. */
export const prefixed = (generator: IdGenerator, prefix: string): IdGenerator => ({
  next: () => `${prefix}${generator.next()}`,
});
