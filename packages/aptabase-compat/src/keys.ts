/**
 * Where an Aptabase client puts its key, and what it looks like.
 *
 * Three places, because their SDKs across five languages do not agree, and a
 * compatibility layer that only accepts the one you happened to read about is
 * not compatible with anything.
 *
 * The key itself is *not* interpreted here. `A-US-1234567890` is Aptabase's
 * format; a customer migrating to Counted holds a `ck_…`. Both arrive on this
 * endpoint, and both are handed to the same resolver, which knows only about
 * digests. This file recognises the *shape* of an Aptabase key solely to say
 * something useful when one shows up that we have never issued — otherwise the
 * answer is "invalid key" and the person spends an afternoon on it.
 */

/** `A-US-`, `A-EU-`, `A-DEV-`, and whatever region they add next. */
const APTABASE_KEY = /^A-[A-Z]{2,4}-\d{10,}$/;

export const looksLikeAptabaseKey = (key: string): boolean => APTABASE_KEY.test(key);

export type KeySource = "app-key" | "project-key" | "query";

export type PresentedKey = { readonly key: string; readonly source: KeySource };

/**
 * Read the key, in the order their SDKs prefer it.
 *
 * `App-Key` is what Aptabase's own SDKs send. `Project-Key` is what Counted's
 * v1 sent, and a customer part-way through a migration will have both kinds of
 * client in the field at once. `?key=` exists because `sendBeacon` cannot set
 * a header, and it is accepted here for the same reason it is accepted on
 * `/v1/events` — an ingest key is already published in the page's own script,
 * so a query string is not a new disclosure.
 */
export const presentedKey = (headers: Headers, url: URL): PresentedKey | null => {
  const appKey = headers.get("app-key");
  if (appKey !== null && appKey.length > 0) return { key: appKey, source: "app-key" };

  const projectKey = headers.get("project-key");
  if (projectKey !== null && projectKey.length > 0) return { key: projectKey, source: "project-key" };

  const query = url.searchParams.get("key");
  if (query !== null && query.length > 0) return { key: query, source: "query" };

  return null;
};
