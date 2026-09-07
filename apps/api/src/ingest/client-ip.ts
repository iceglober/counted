/**
 * The client's address, from a header, counted from the right.
 *
 * This is the only function in the API that reads an IP address, and it exists
 * to hand one to `GeoLocator.countryOf` and then let it go. Nothing keeps it:
 * `handleIngest` holds it in a local, converts it to two letters, and never
 * logs it. That discard is what keeps "no IP storage" true while a country
 * breakdown exists.
 *
 * ### Why counting from the right, and why a configured number
 *
 * `X-Forwarded-For` is a list, and each proxy *appends the address it received
 * the connection from*. So with one trusted proxy in front — Railway's edge —
 * the list ends with the address that proxy saw, which is the client. A client
 * that sends its own `X-Forwarded-For: 1.2.3.4` gets `1.2.3.4, <its real
 * address>`: the value it made up is at the front, and reading from the right
 * ignores it.
 *
 * Reading the *leftmost* entry is the common implementation and it is
 * spoofable by anyone who can set a header — which, for an ingest endpoint that
 * accepts a public key from a browser, is everybody. That is not a theoretical
 * hole: it would let a caller assign its events to any country it liked, and
 * the resulting chart would look entirely normal.
 *
 * The hop count has to be configured because only the operator knows the
 * topology. One proxy is the default and matches the deployed setup; a CDN in
 * front of it makes it two. Set it to `0` on a deployment where nothing
 * trustworthy sets the header, and no country is derived at all — which is the
 * right answer for "I cannot tell whose address this is".
 *
 * A list shorter than the configured hop count means the request did not come
 * through the proxies the operator described. That is refused rather than
 * guessed at: the answer would be the client's own claim.
 */

/** The header every reverse proxy in this stack appends to. */
export const FORWARDED_FOR = "x-forwarded-for";

/** One trusted proxy: the platform edge. Overridden by COUNTED_TRUSTED_PROXY_HOPS. */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * The address `hops` proxies back from the end of `X-Forwarded-For`, or `null`.
 *
 * Returns the raw entry, unvalidated. Parsing it is `addressKey`'s job in the
 * geo adapter, and doing it twice would be two definitions of what an address
 * is.
 */
export const clientAddress = (headers: Headers, hops: number): string | null => {
  if (!Number.isInteger(hops) || hops < 1) return null;

  const header = headers.get(FORWARDED_FOR);
  if (header === null) return null;

  const entries = header.split(",");
  const at = entries.length - hops;
  if (at < 0) return null;

  const entry = entries[at]?.trim();
  return entry === undefined || entry.length === 0 ? null : entry;
};
