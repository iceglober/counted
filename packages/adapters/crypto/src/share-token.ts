/**
 * Share links: a secret the customer holds, and a digest we store.
 *
 * `DashboardRepository.findByShareDigest(digest)` takes a digest and not a
 * token, and that is the whole design. The token exists in exactly two places
 * — the URL we hand back once, and the request that later arrives — and never
 * in the database. A dump of the dashboards table therefore does not contain a
 * single working share link.
 *
 * No salt and no key stretching, deliberately. Both defend against guessing a
 * low-entropy secret, and this one has 256 random bits: there is nothing to
 * guess and nothing to build a rainbow table against. A per-row salt would
 * also make the lookup impossible — you cannot index by a digest you can only
 * compute after finding the row.
 */

import { sha256Base64Url } from "./digest";
import { randomToken } from "./random";

/** 32 bytes, base64url. Long enough that enumeration is not a strategy. */
export const newShareToken = (): string => randomToken(32);

/**
 * The stored form of a share token.
 *
 * Base64url so it is safe to log, safe to put in a URL if that ever becomes
 * useful, and the same width every time — which is what lets
 * `constantTimeEquals` be constant-time on it.
 */
export const shareTokenDigest = (token: string): string => sha256Base64Url(token);
