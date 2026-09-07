/**
 * `country` — the one thing on an event that Counted works out rather than
 * being told.
 *
 * Every other system property arrives from the SDK. This one is derived at the
 * edge from the address the request came from, and the address is discarded in
 * the same breath: it is a local in the route handler, it is turned into two
 * letters, and it reaches neither a log line, a domain type, nor a column. That
 * is what keeps "no cookies, no fingerprinting, no PII" true while still
 * answering the most-asked-for question about a chart. It is what Plausible
 * does, and it is the reason a country slice does not need a consent banner.
 *
 * **A client may not set it.** `normaliseSystemProperties` reads `country` from
 * its second argument and never from the payload, so a `systemProperties`
 * object carrying `country: "US"` is dropped like any other unknown key. Two
 * reasons, and the second is the one that matters: a client-set country is a
 * number a customer can make up, and — worse — a client that can put a string
 * in this field can put an address in it, which would defeat the discard.
 *
 * **`null` means "we could not tell", and it is a real answer.** Private
 * ranges, an unrecognisable `X-Forwarded-For`, address space no registry has
 * delegated, and blocks recorded against the European Union rather than a
 * country all land here. litics rolls a null dimension up under the sentinel
 * dictionary id 0 and the catalog join drops it, so an event we could not place
 * is simply absent from a country breakdown rather than appearing as a bucket
 * named "unknown" that a reader would take for a place.
 *
 * This is deliberately unlike `os_name`, which is total. A missing OS is a bug
 * in an SDK we ship and `other` names it; a missing country is an ordinary
 * consequence of how somebody reaches the internet and inventing a value for it
 * would be inventing data.
 */

import type { Brand } from "@counted/kernel";

/**
 * ISO 3166-1 alpha-2, upper case. Branded so it cannot be built by assignment:
 * the only way to obtain one is `admitCountry`, which is the only place the
 * shape is checked.
 */
export type CountryCode = Brand<string, "CountryCode">;

const SHAPE = /^[A-Z]{2}$/;

/**
 * Read an untrusted two-letter code.
 *
 * Case is folded up rather than refused — a locator or an operator override may
 * reasonably write `us` — but nothing else is repaired. In particular a longer
 * string is refused rather than truncated, because the string this function
 * must never accept is an IP address, and truncating one to two characters
 * would turn `19.…` into a code rather than into a refusal.
 */
export const admitCountry = (raw: unknown): CountryCode | null => {
  if (typeof raw !== "string") return null;
  const folded = raw.trim().toUpperCase();
  return SHAPE.test(folded) ? (folded as CountryCode) : null;
};

export const isCountryCode = (value: unknown): value is CountryCode =>
  typeof value === "string" && SHAPE.test(value);
