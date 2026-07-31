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

import { NextResponse } from "next/server";
import { serverApiUrl } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (token === null) return NextResponse.redirect(new URL("/sign-in?error=missing", request.url));

  const response = await fetch(new URL("/v1/auth/session", serverApiUrl()), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });

  if (!response.ok) {
    // One message for expired, spent and never-issued — the API already
    // refuses to tell them apart, and re-deriving a reason here would undo it.
    return NextResponse.redirect(new URL("/sign-in?error=link", request.url));
  }

  const redirect = NextResponse.redirect(new URL("/", request.url));

  // Copied, not rebuilt. Every attribute the API chose — Domain, Max-Age,
  // SameSite, HttpOnly — is the API's decision, and re-deriving them here is
  // how the two would come to disagree.
  const setCookie = response.headers.get("set-cookie");
  if (setCookie !== null) redirect.headers.set("set-cookie", setCookie);

  return redirect;
}
