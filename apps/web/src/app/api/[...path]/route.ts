/**
 * The proxy. Everything under `/api/*` is forwarded to the API; everything else
 * is a page this app renders itself.
 *
 * **It forwards authority and never adds any.** The outbound request's headers
 * are a subset of the inbound request's headers, computed by
 * `forwardedRequestHeaders`, and nothing in this file reads a credential from
 * the environment — there is none to read. That is what makes "every console
 * action is reachable by a third party with the right key" a true statement
 * about this product rather than an aspiration: the console is a browser with
 * a nicer stylesheet, not a privileged client.
 *
 * The mechanical half of the guarantee is `the-console-holds-no-credential` in
 * `.dependency-cruiser.cjs`, which stops this app importing a server-side
 * package at all. The behavioural half is `lib/no-credentials.test.ts`.
 */

import {
  forwardedLocation,
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  upstreamPathFor,
} from "../../../lib/forward";
import { apiOrigin, consoleOrigin } from "../../../lib/env";

/**
 * Never prerendered and never cached. A proxied response is by definition a
 * function of the caller's cookie, and a cached one would be one user's data
 * served to the next.
 */
export const dynamic = "force-dynamic";

const refused = (path: string): Response =>
  new Response(
    JSON.stringify({
      code: "NOT_FOUND",
      message: `The console does not proxy ${path}.`,
    }),
    { status: 404, headers: { "content-type": "application/json" } },
  );

const proxy = async (request: Request): Promise<Response> => {
  const incoming = new URL(request.url);
  const upstreamPath = upstreamPathFor(incoming.pathname);
  if (upstreamPath === null) return refused(incoming.pathname);

  const api = apiOrigin();
  const target = `${api}${upstreamPath}${incoming.search}`;

  // The body is buffered rather than streamed. A streamed request body needs
  // `duplex: "half"`, which is not portable across the runtimes this app is
  // deployed on, and every console request is a small JSON object — the ingest
  // hot path does not come through here.
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: forwardedRequestHeaders(request.headers),
      ...(body === undefined ? {} : { body }),
      // Followed redirects would resolve on the server, so a sign-in redirect
      // would land here instead of in the browser's address bar and the user
      // would never leave the page they submitted from.
      redirect: "manual",
      cache: "no-store",
    });
  } catch (cause) {
    return new Response(
      JSON.stringify({
        code: "SERVICE_UNAVAILABLE",
        message: "The API could not be reached.",
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }

  const headers = forwardedResponseHeaders(upstream.headers);
  const location = headers.get("location");
  if (location !== null) headers.set("location", forwardedLocation(location, api, consoleOrigin()));

  return new Response(upstream.body, { status: upstream.status, headers });
};

export {
  proxy as GET,
  proxy as HEAD,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
};
