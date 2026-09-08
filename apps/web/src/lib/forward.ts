/**
 * The proxy's rules, as pure functions.
 *
 * The console serves its own pages and forwards `/api/*` to the API with the
 * caller's cookie. The invariant that keeps the whole system API-first is that
 * **the proxy forwards authority and never adds any**: every header on the
 * outbound request came off the inbound one. Not "mostly" — every one. The
 * `forwardedRequestHeaders` test asserts the output key set is a subset of the
 * input key set, which is a property no allowlist edit can quietly break.
 *
 * Why any of this exists rather than the browser calling the API directly:
 * the session cookie belongs to whichever origin set it. Two origins means
 * either a third-party cookie (dying) or a wildcard CORS policy plus
 * credentials (an origin-confusion bug waiting to be written). One origin,
 * with the console forwarding, has neither problem — and it is also what makes
 * the console demonstrably no more privileged than `curl`.
 */

/**
 * Where `apps/api` mounts things. Restated here because `apps-are-independent`
 * forbids importing them, and a shared constant package for two strings would
 * be worse. If `AUTH_MOUNT` moves in `apps/api/src/server.ts`, this moves too —
 * the sign-in page stops working immediately and loudly, which is the failure
 * mode you want for a constant that cannot be typed across the boundary.
 */
const AUTH_MOUNT = "/api/auth";
const API_PREFIX = "/v1";

/** The console path everything is proxied under. */
export const PROXY_MOUNT = "/api";

/**
 * The upstream path for a console path, or `null` if the proxy refuses it.
 *
 * Refusal is the default. An open relay onto the API's whole surface would
 * expose `/health`, `/ready` and anything added later to the public internet
 * through a path nobody audited, and the console needs exactly two families of
 * route.
 */
export const upstreamPathFor = (consolePath: string): string | null => {
  const path = consolePath.replace(/\/+$/, "") || "/";

  // better-auth owns its own mount and its cookies are issued against the paths
  // it sees, so this family passes through unchanged rather than being rewritten.
  if (path === AUTH_MOUNT || path.startsWith(`${AUTH_MOUNT}/`)) return path;

  if (!path.startsWith(`${PROXY_MOUNT}${API_PREFIX}/`) && path !== `${PROXY_MOUNT}${API_PREFIX}`) {
    return null;
  }

  const upstream = path.slice(PROXY_MOUNT.length);

  // Stripe verifies a signature over the exact bytes it sent. A proxy that has
  // parsed and re-serialized the body has destroyed the thing being verified,
  // and a webhook that "works" through here would be one whose signature check
  // is meaningless. The provider is configured with the API's own URL.
  if (upstream === "/v1/webhooks/stripe") return null;

  return upstream;
};

/**
 * Headers the proxy passes upstream.
 *
 * `cookie` and `authorization` are the caller's own credentials — forwarding
 * them is the job. The rest are what let the API answer correctly at all
 * (content type, negotiated language) or trace the request. Nothing on this
 * list can be set by the console; every value comes off the inbound request.
 */
export const FORWARDED_REQUEST_HEADERS: readonly string[] = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  // better-auth refuses a POST without an `Origin` (its CSRF check: the
  // request must come from an origin it trusts, and the console's is one).
  // The browser set these; forwarding them adds no authority.
  "origin",
  "referer",
  "user-agent",
  "x-counted-trace",
];

/**
 * An allowlist, not a denylist, and deliberately.
 *
 * A denylist forwards `host`, which makes the API resolve its own base URL
 * against the console's hostname — better-auth then issues cookies for an
 * origin it is not serving and every sign-in silently produces no session. It
 * also forwards `x-forwarded-for` unvalidated, which is a rate limiter's worst
 * input. Anything genuinely needed upstream gets added here on purpose.
 */
export const forwardedRequestHeaders = (incoming: Headers): Headers => {
  const outgoing = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) outgoing.set(name, value);
  }
  return outgoing;
};

/**
 * Headers dropped on the way back.
 *
 * `content-encoding` and `content-length` describe the *compressed* upstream
 * body, and `fetch` has already decompressed it by the time we see it —
 * forwarding either one makes the browser try to gunzip plain bytes and render
 * a broken page with a 200 status. The rest are hop-by-hop by definition.
 */
const DROPPED_RESPONSE_HEADERS: readonly string[] = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "transfer-encoding",
  "upgrade",
];

/**
 * A denylist here, unlike the request direction: the API is trusted to decide
 * what the browser should be told, and a new response header it adds should
 * reach the browser without an edit in this file.
 *
 * `set-cookie` is copied through `getSetCookie()` rather than `get()`, because
 * `get("set-cookie")` joins several cookies with a comma and a cookie value may
 * legally contain one — which is how a sign-in that sets two cookies ends up
 * setting one broken one.
 */
export const forwardedResponseHeaders = (upstream: Headers): Headers => {
  const outgoing = new Headers();
  for (const [name, value] of upstream) {
    if (name.toLowerCase() === "set-cookie") continue;
    if (DROPPED_RESPONSE_HEADERS.includes(name.toLowerCase())) continue;
    outgoing.set(name, value);
  }
  for (const cookie of upstream.getSetCookie()) outgoing.append("set-cookie", cookie);
  return outgoing;
};

/**
 * Rewrites a redirect that points back at the API onto the console.
 *
 * A redirect to the API's own origin takes the browser off the origin that
 * holds the session cookie, so the page it lands on is signed out and the user
 * is told to sign in again immediately after signing in. Redirects to anywhere
 * else — the provider's hosted checkout, for instance — are left alone, since
 * rewriting those is how you break the thing you were proxying for.
 */
export const forwardedLocation = (
  location: string,
  apiOrigin: string,
  consoleOrigin: string,
): string => {
  let target: URL;
  try {
    target = new URL(location, apiOrigin);
  } catch {
    return location;
  }
  if (target.origin !== new URL(apiOrigin).origin) return location;

  const back =
    target.pathname === AUTH_MOUNT || target.pathname.startsWith(`${AUTH_MOUNT}/`)
      ? target.pathname
      : `${PROXY_MOUNT}${target.pathname}`;

  return new URL(`${back}${target.search}${target.hash}`, consoleOrigin).toString();
};
