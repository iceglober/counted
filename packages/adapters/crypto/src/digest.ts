/**
 * Hashing, keyed hashing, and the one comparison that is allowed to look at a
 * secret.
 *
 * Everything here is synchronous on purpose. Two callers need it in a
 * synchronous context — `BillingGateway.verifyWebhook` returns a `Result` and
 * not a `Promise<Result>`, and the share-link lookup happens inside a
 * repository call — and `node:crypto`'s sync API is the only one in this
 * runtime that can serve them. WebCrypto's `subtle` is async-only, which is
 * exactly why the Stripe SDK cannot verify a signature here; see
 * `@counted/adapter-stripe`'s signature.ts.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const utf8 = (value: string): Buffer => Buffer.from(value, "utf8");

export const sha256 = (value: string | Uint8Array): Buffer =>
  createHash("sha256")
    .update(typeof value === "string" ? utf8(value) : value)
    .digest();

export const sha256Hex = (value: string | Uint8Array): string => sha256(value).toString("hex");

/**
 * Base64url, unpadded. The form that survives a URL path segment, a query
 * string and a `Set-Cookie` value without re-encoding — which matters because
 * a digest that gets percent-encoded on one path and not another stops
 * matching itself.
 */
export const sha256Base64Url = (value: string | Uint8Array): string =>
  sha256(value).toString("base64url");

export const hmacSha256 = (key: string | Uint8Array, message: string | Uint8Array): Buffer =>
  createHmac("sha256", typeof key === "string" ? utf8(key) : key)
    .update(typeof message === "string" ? utf8(message) : message)
    .digest();

export const hmacSha256Hex = (key: string | Uint8Array, message: string | Uint8Array): string =>
  hmacSha256(key, message).toString("hex");

export const hmacSha256Base64 = (key: string | Uint8Array, message: string | Uint8Array): string =>
  hmacSha256(key, message).toString("base64");

/**
 * Compare two secrets without leaking how far they matched.
 *
 * `crypto.timingSafeEqual` **throws** when the two buffers differ in length,
 * so the obvious wrapper turns a wrong-length guess into a 500 and a
 * right-length guess into a 401 — which is a length oracle built out of the
 * function that exists to prevent one. Unequal lengths return false here, and
 * that comparison is not constant-time with respect to length. It does not
 * need to be: every secret this is used on has a fixed length, so a length
 * mismatch is a malformed input rather than a nearly-correct guess.
 */
export const constantTimeEquals = (a: string, b: string): boolean => {
  const left = utf8(a);
  const right = utf8(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};
