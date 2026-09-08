import { docsOrigin, siteOrigin, publicApiOrigin } from "../../../lib/site";
export const dynamic = "force-dynamic";
export function GET(): Response {
  return Response.json({ linkset: [{ anchor: publicApiOrigin(), "service-desc": [{ href: `${docsOrigin()}/openapi.json`, type: "application/vnd.oai.openapi+json;version=3.1", title: "Counted OpenAPI 3.1" }], "service-doc": [{ href: docsOrigin(), type: "text/html", title: "Counted API reference" }, { href: `${siteOrigin()}/auth.md`, type: "text/markdown", title: "Counted authentication" }] }] }, { headers: { "content-type": 'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"', "cache-control": "public, max-age=300" } });
}
