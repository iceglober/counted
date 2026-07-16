import { jsonld, SITE, SKILLS } from "@/lib/agent-meta";

// Agent Skills index — lists Counted's capabilities so agents can find and parse
// what it offers.
export function GET() {
  return jsonld({
    name: "Counted",
    description: "Privacy-first product analytics capabilities exposed to agents.",
    url: SITE,
    documentation: `${SITE}/llms.txt`,
    skills: SKILLS.map((s) => ({
      name: s.name,
      description: s.description,
      documentation: `${SITE}/llms-full.txt`,
    })),
  });
}
