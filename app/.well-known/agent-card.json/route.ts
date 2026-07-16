import { jsonld, SITE, API, SKILLS } from "@/lib/agent-meta";

// A2A (Agent-to-Agent) agent card.
export function GET() {
  return jsonld({
    name: "Counted",
    description:
      "Privacy-first product analytics: custom events, funnels, and composable dashboards with no cookies or PII. Provision a key with no signup, ingest events, and query metrics over HTTP.",
    url: SITE,
    version: "0.1.0",
    documentationUrl: `${SITE}/llms.txt`,
    provider: { organization: "Iceglobe Enterprises LLC", url: SITE },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      tags: ["analytics", "events", "privacy"],
    })),
    endpoints: {
      openapi: `${SITE}/openapi.json`,
      apiBase: `${API}/api/v0`,
      provision: `${API}/api/v0/provision`,
    },
  });
}
