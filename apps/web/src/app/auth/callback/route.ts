/**
 * The magic-link callback. One of the few things this app does server-side.
 *
 * Sits at `/auth/callback` rather than under a `/bff/` prefix because this
 * URL is the one a person sees in their mail client. What makes it a BFF
 * endpoint is that it runs on the server, not where it is mounted.
 *
 * Why it cannot be a browser `fetch`: the user arrives here by clicking a link
 * in their mail client, which is a top-level navigation, not a script. Nothing
 * is running yet to make a request, and `Set-Cookie` on a cross-origin
 * redirect chain is fragile enough that "it works in Chrome" is not evidence.
 *
 * So this handler redeems the token server-side and re-emits the API's own
 * `Set-Cookie` verbatim. It does not mint, parse, or understand the session —
 * that would be a second implementation of auth, which is the thing the whole
 * design is avoiding.
 */

import { cookies } from "next/headers";
import { serverApiUrl } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Redirect to a path, never to an origin we had to reconstruct.
 *
 * This handler used `new URL(path, request.url)`, and inside the container
 * `request.url` carries the bind address — so every redirect it produced
 * pointed at `http://0.0.0.0:3000`. Sign-in was broken for *both* outcomes: a
 * bad token sent you to `0.0.0.0:3000/sign-in?error=link`, and a good one sent
 * you to `0.0.0.0:3000/` with the session cookie attached to a page that
 * cannot load. The redirect, not the token, was the failure.
 *
 * The fix is to stop deriving an origin at all. `Location` may be a relative
 * reference (RFC 9110 §10.2.2), which the browser resolves against the URL it
 * actually visited — the public one, by construction. Reading
 * `x-forwarded-host` would also work, but it trusts a header and can still be
 * wrong; a relative path cannot name the wrong host because it names no host.
 */
const redirectTo = (path: string, setCookie: string | null): Response => {
  const headers = new Headers({ location: path });
  // Copied verbatim, not rebuilt. Every attribute the API chose — Domain,
  // Max-Age, SameSite, HttpOnly — is the API's decision, and re-deriving them
  // here is how the two would come to disagree.
  if (setCookie !== null) headers.set("set-cookie", setCookie);
  // 303: the visitor arrived by clicking a link and should GET the target.
  return new Response(null, { status: 303, headers });
};

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (token === null) return redirectTo("/sign-in?error=missing", null);

  const response = await fetch(new URL("/v1/auth/session", serverApiUrl()), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });

  if (!response.ok) {
    // One message for expired, spent and never-issued — the API already
    // refuses to tell them apart, and re-deriving a reason here would undo it.
    return redirectTo("/sign-in?error=link", null);
  }

  // The console, not "/". This app serves both counted.dev and
  // app.counted.dev, so "/" is the *marketing* homepage — signing in
  // successfully dropped the user on the landing page, cookie set, with no
  // sign that anything had happened. /dashboards resolves the caller's
  // workspace, or sends a brand-new account to /start.
  // Return them to whatever they were trying to reach — most often a claim
  // link, where dropping them at /dashboards would lose the project they came
  // for. Validated again here rather than trusted: a cookie is caller-writable,
  // so this re-checks the same-origin rule the sign-in page applied.
  const wanted = (await cookies()).get("counted_next")?.value;
  const decoded = wanted === undefined ? null : decodeURIComponent(wanted);
  const next =
    decoded !== null && decoded.startsWith("/") && !decoded.startsWith("//") ? decoded : "/dashboards";

  const headers = new Headers({ location: next });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie !== null) headers.append("set-cookie", setCookie);
  // Spend it. A stale destination outliving the sign-in that wanted it would
  // send the *next* sign-in somewhere surprising.
  headers.append("set-cookie", "counted_next=; Max-Age=0; Path=/; SameSite=Lax");
  return new Response(null, { status: 303, headers });
}
