import { API_URL, SITE_URL } from "../../../lib/urls";

/**
 * RFC 9727 API catalog.
 *
 * The API lives on `api.counted.dev` and the marketing site on the apex, so
 * anything probing `counted.dev/openapi.json` finds nothing and concludes
 * there is no API. That is not a hypothetical — an agent-readiness scan
 * reported "no OpenAPI specification found" and "no publicly reachable API
 * surface" for a product whose spec has been served at
 * `api.counted.dev/v1/openapi.json` the whole time.
 *
 * This is the standard way to say "the API is over there" from the apex.
 */
export const dynamic = "force-static";
export const revalidate = 86_400;

export function GET(): Response {
  const body = {
    linkset: [
      {
        anchor: API_URL,
        "service-desc": [
          {
            href: `${API_URL}/v1/openapi.json`,
            type: "application/vnd.oai.openapi+json;version=3.1",
            title: "Counted API — OpenAPI 3.1 description",
          },
        ],
        "service-doc": [
          { href: `${SITE_URL}/docs/api`, type: "text/html", title: "Counted API reference" },
          { href: `${SITE_URL}/auth.md`, type: "text/markdown", title: "Authenticating with Counted" },
        ],
        "service-meta": [
          {
            href: `${API_URL}/.well-known/oauth-protected-resource`,
            type: "application/json",
            title: "Protected-resource metadata (RFC 9728)",
          },
        ],
        status: [{ href: `${API_URL}/health/ready`, type: "application/json", title: "Readiness" }],
      },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      // The profile parameter is what makes this a catalog rather than an
      // anonymous linkset.
      "content-type":
        'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"',
      "cache-control": "public, max-age=3600",
    },
  });
}
