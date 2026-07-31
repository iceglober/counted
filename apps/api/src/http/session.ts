/**
 * The console session cookie, and the CSRF defence that goes with it.
 *
 * The API owns the auth material. `app.counted.dev` and `api.counted.dev` are
 * the same registrable domain, so a `Domain=.counted.dev` cookie is sent on
 * `fetch(..., {credentials: "include"})` from the app and `SameSite=Lax`
 * permits it — a browser calls the API directly and there is no proxy layer
 * re-describing the API to itself.
 *
 * **Why an `Origin` check instead of a CSRF token.** A cookie is ambient
 * authority: it rides along on requests the user did not intend to make. The
 * classic answer is a token the attacker cannot read, which needs state, a
 * rotation story, and a way to get the token into every form. The `Origin`
 * header is set by the browser on every mutating cross-origin request, cannot
 * be forged by page JavaScript, and needs nothing stored — so this is strictly
 * stronger and has no moving parts.
 *
 * It applies **only** to cookie-authenticated mutations. A Bearer credential
 * is not ambient — an attacker's page cannot make the browser attach one — so
 * requiring an `Origin` there would break every server-side API client for no
 * gain.
 */

import type { Context } from "hono";
import type { ApiEnv } from "../server";

export const SESSION_COOKIE = "counted_session";

/**
 * The one place cookie attributes are written.
 *
 * - `HttpOnly` — script cannot read it, so an XSS is not automatically a
 *   stolen session.
 * - `Secure` — never sent over plain HTTP. Omitted on localhost only, because
 *   a browser will not store a `Secure` cookie from `http://localhost` and
 *   development would be impossible.
 * - `SameSite=Lax` — the app and the API are same-site, so this permits the
 *   app's own `fetch` (including POSTs) while excluding a third-party page's.
 * - `Domain` — set so one cookie serves both `app.` and `api.`; absent in
 *   development, where the host is `localhost` and a domain attribute on it
 *   is invalid.
 */
export type CookieOptions = {
  /** `.counted.dev` in production; absent for localhost. */
  readonly domain: string | undefined;
  readonly secure: boolean;
};

export const cookieOptionsFor = (appUrl: string): CookieOptions => {
  let host: string;
  try {
    host = new URL(appUrl).hostname;
  } catch {
    host = "localhost";
  }
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) {
    return { domain: undefined, secure: false };
  }
  // The registrable domain, so `app.` and `api.` share one cookie. Taking the
  // last two labels is right for `counted.dev`; it would be wrong for a
  // multi-part public suffix like `co.uk`, which this deployment does not use
  // and which would need the public suffix list to do properly.
  const labels = host.split(".");
  const registrable = labels.length >= 2 ? labels.slice(-2).join(".") : host;
  return { domain: `.${registrable}`, secure: true };
};

export const serializeSessionCookie = (
  value: string,
  maxAgeSeconds: number,
  options: CookieOptions,
): string => {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (options.domain !== undefined) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
};

/** Expiring the cookie must repeat every attribute, or the browser keeps it. */
export const clearedSessionCookie = (options: CookieOptions): string =>
  serializeSessionCookie("", 0, options);

/**
 * Read one cookie out of a `Cookie` header.
 *
 * Hand-parsed rather than pulled from a library because the rules are three
 * lines and the value is base64url, which contains no `=` padding but may
 * contain `-` and `_`. Splitting on every `=` rather than the first would
 * truncate it.
 */
export const readCookie = (header: string | undefined, name: string): string | null => {
  if (header === undefined) return null;
  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) === name) return trimmed.slice(separator + 1);
  }
  return null;
};

/** Methods that can change something. `GET`/`HEAD` need no CSRF defence. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type OriginPolicy = {
  /** Exact origins allowed to make cookie-authenticated mutations. */
  readonly allowed: readonly string[];
};

/**
 * The allowlist, derived from configuration rather than hand-listed.
 *
 * Two lists of origins that must agree is the shape that goes stale, and the
 * way it goes stale here is a deploy where the app can read but not write.
 */
export const originPolicyFor = (appUrl: string): OriginPolicy => {
  const allowed = new Set<string>();
  try {
    const url = new URL(appUrl);
    allowed.add(url.origin);
    // The marketing site sits on the apex and posts the sign-in form.
    const labels = url.hostname.split(".");
    if (labels.length > 2) allowed.add(`${url.protocol}//${labels.slice(-2).join(".")}`);
  } catch {
    /* an unparseable appUrl allows nothing, which fails closed */
  }
  return { allowed: [...allowed] };
};

export const isAllowedOrigin = (origin: string | undefined, policy: OriginPolicy): boolean =>
  origin !== undefined && policy.allowed.includes(origin);

/**
 * Whether this request must present an allowed `Origin`.
 *
 * True only when the request both mutates and is authenticated by the cookie.
 * A request carrying a Bearer credential is exempt: nothing ambient attached
 * it, so there is no confused deputy to defend against.
 */
export const requiresOrigin = (c: Context<ApiEnv>): boolean => {
  if (!MUTATING.has(c.req.method.toUpperCase())) return false;
  if (c.req.header("authorization") !== undefined) return false;
  return readCookie(c.req.header("cookie"), SESSION_COOKIE) !== null;
};

/** CORS headers for an allowed origin. Never `*`, because credentials flow. */
export const corsHeadersFor = (origin: string | undefined, policy: OriginPolicy): Record<string, string> => {
  if (!isAllowedOrigin(origin, policy)) return {};
  return {
    // Echoed from the allowlist. `*` is not merely weaker here — a browser
    // refuses to send credentials to it at all, so this would silently sign
    // every request out.
    "access-control-allow-origin": origin as string,
    "access-control-allow-credentials": "true",
    vary: "origin",
  };
};
