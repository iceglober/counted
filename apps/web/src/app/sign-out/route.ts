import { cookies } from "next/headers";
import { serverApiUrl } from "@/lib/api";

/**
 * Sign out.
 *
 * The console nav links here, and until now nothing served it — a dead link in
 * the one place a person goes when they want to be sure they are signed out is
 * worse than no link at all.
 *
 * Server-side for the same reason the sign-in callback is: this is a top-level
 * navigation from a click, and the cookie it needs to clear belongs to the API
 * origin. The API's `DELETE /v1/auth/session` both revokes the session and
 * returns the expiring `Set-Cookie`; this passes that through verbatim rather
 * than clearing a cookie it would have to describe itself.
 *
 * The redirect is relative, so it cannot name the container's bind address the
 * way the sign-in callback used to.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const cookie = (await cookies()).toString();

  let setCookie: string | null = null;
  try {
    const response = await fetch(new URL("/v1/auth/session", serverApiUrl()), {
      method: "DELETE",
      headers: cookie === "" ? {} : { cookie },
      cache: "no-store",
    });
    setCookie = response.headers.get("set-cookie");
  } catch {
    // A failure to reach the API must not strand somebody on a page that says
    // nothing. Sending them to sign-in is the honest outcome either way: the
    // session may still be live server-side, and signing in again replaces it.
  }

  const headers = new Headers({ location: "/sign-in" });
  if (setCookie !== null) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 303, headers });
}
