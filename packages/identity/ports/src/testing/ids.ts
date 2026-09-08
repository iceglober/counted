/**
 * A deterministic IdGenerator for tests.
 *
 * `@counted/adapter-crypto` owns the real one — it is the only randomness in
 * the system. This one counts, so a failing test names the same id every run
 * and a diff of two runs is empty rather than noise.
 */

import type { IdGenerator } from "@counted/kernel/ports";

export const countingIdGenerator = (prefix = "id"): IdGenerator => {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${prefix}_${n}`;
    },
  };
};
