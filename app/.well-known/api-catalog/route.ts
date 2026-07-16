import { SITE, API } from "@/lib/agent-meta";

// RFC 9727 API catalog — points agents at the OpenAPI spec and service docs.
export function GET() {
  const body = {
    linkset: [
      {
        anchor: SITE,
        "service-desc": [
          { href: `${SITE}/openapi.json`, type: "application/json", title: "Counted API (OpenAPI)" },
        ],
        "service-doc": [
          { href: `${SITE}/docs/api`, type: "text/html", title: "Counted API reference" },
          { href: `${SITE}/llms.txt`, type: "text/plain", title: "Agent guide" },
        ],
        status: [{ href: `${API}/api/health`, title: "Health" }],
      },
    ],
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type":
        'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"',
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
