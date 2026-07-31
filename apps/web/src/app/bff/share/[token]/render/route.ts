import { ApiError, serverApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Re-render a shared dashboard.
 *
 * The one place a BFF is genuinely required. The page's own interactivity —
 * changing a time range — needs a request the browser initiates, and the only
 * credential that authorizes it is the share token. Letting the browser make
 * that request directly would mean putting `Authorization: Bearer st_…` into
 * page JavaScript, which is precisely what this design refuses.
 *
 * So the token is re-read here, from this route's own path, server-side. The
 * client calls its own origin with a path it already has in the address bar,
 * and never constructs a credential.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;

  // Whatever the client asked for — a time range — forwarded as-is. This route
  // is a courier, not a second description of the render endpoint, so it goes
  // through the same typed client as every other call rather than hand-rolling
  // a request to the API.
  const asked = await request.json().catch(() => ({}));

  const shielded = {
    "content-type": "application/json",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "cache-control": "private, no-store",
  };

  try {
    const { data } = await serverApi(null)("renderSharedDashboard", { bearer: token, body: asked });
    return Response.json(data, { headers: shielded });
  } catch (error) {
    // The status is forwarded, so a link revoked while somebody had the page
    // open stops working here exactly as it does on first load — rather than
    // becoming a stale page whose refresh button quietly does nothing.
    const status = error instanceof ApiError ? error.status : 502;
    return Response.json({ error: "unavailable" }, { status, headers: shielded });
  }
}
