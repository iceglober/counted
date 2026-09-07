/**
 * The only randomness in the system.
 *
 * The domain cannot reach a random number generator — `domain-is-pure` forbids
 * `node:crypto` and everything else — so every secret, token and id is minted
 * here and passed in as a value. That is what makes an aggregate test
 * deterministic without patching a global.
 *
 * `Math.random` appears nowhere in this package and must not. It is seeded
 * from the process start and is predictable from a handful of outputs; a share
 * link minted from it is guessable.
 */

import { randomBytes as nodeRandomBytes, randomInt as nodeRandomInt } from "node:crypto";

export const randomBytes = (count: number): Buffer => nodeRandomBytes(count);

/**
 * A URL-safe token with `bytes` bytes of entropy.
 *
 * Base64url and unpadded, so it survives a path segment, a query string and a
 * copy-paste out of a chat window unchanged. 32 bytes is the default because
 * that is the width at which guessing stops being a strategy: 256 bits.
 */
export const randomToken = (bytes = 32): string => nodeRandomBytes(bytes).toString("base64url");

/**
 * A uniformly distributed integer in `[0, exclusiveMax)`.
 *
 * Rejection-sampled by `node:crypto`, not `randomBytes(4) % n`, which is
 * biased whenever `n` is not a power of two.
 */
export const randomInt = (exclusiveMax: number): number => nodeRandomInt(exclusiveMax);
