/**
 * @counted/adapter-crypto — id generation, digesting, and the machine clock.
 *
 * The only randomness in the system. The domain forbids it, so every id is
 * minted here and passed in — which is what makes aggregate tests
 * deterministic without patching globals.
 *
 * Everything exported is synchronous. Two callers need it that way and cannot
 * be changed: `BillingGateway.verifyWebhook` returns a `Result`, not a
 * `Promise<Result>`, and a share-digest lookup happens inside a repository
 * call. WebCrypto's `subtle` is async-only, so `node:crypto` is the primitive
 * here and not an implementation detail that could later be swapped for
 * `crypto.subtle`.
 */

export { systemClock } from "./clock";
export { uuidV7Generator, sequentialIdGenerator, prefixed } from "./ids";
export { randomBytes, randomToken, randomInt } from "./random";
export {
  sha256,
  sha256Hex,
  sha256Base64Url,
  hmacSha256,
  hmacSha256Hex,
  hmacSha256Base64,
  constantTimeEquals,
} from "./digest";
export { newShareToken, shareTokenDigest } from "./share-token";
