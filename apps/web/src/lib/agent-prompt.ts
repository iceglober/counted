import { consoleOrigin } from "./env";
import { docsOrigin, siteOrigin } from "./site";

export function agentPrompt(): string {
  return `Help me choose useful questions and add Counted to this product with the smallest working integration.

Counted is open-source, self-hostable, privacy-first product analytics. Today it answers event counts, unique visits, trends, property breakdowns, and ordered visit funnels. Dashboards contain Insights. Distinct-person/account queries, cross-visit retention, and sums of arbitrary numeric properties are NOT currently available. Accepting identify() or numeric properties does not mean those analyses work. Do not propose them as supported or collect IDs for queries we cannot answer.

First, read the current repository's instructions and inspect just enough of the product, routes, and existing analytics to understand its main journeys. If there is no recognizable repository/product in the current directory, or you cannot access files, ask for a repository path, product URL, or short description. Do not search unrelated directories or invent a product. If only a URL/description is available, label assumptions and defer code changes until source access is available.

Your first response should briefly describe the product, then propose 3–5 plain-language, human-readable questions Counted can answer about it. Avoid API vocabulary and event catalogs. For each question, mark its identity mode:
- [Anonymous visits]: uses events and temporary visits, with optional non-identifying categories. Visits are not distinct people. Login counts, feature-use counts, and visit funnels can use this mode.
- [Identified users]: needs an opaque customer-supplied identity across visits. Person-based analytics are currently unavailable: if I ask for such a question, mark it unavailable and explain why rather than recommending identity collection. Never force an identified-user question into the list.

Ask me to accept, remove, rewrite, or add questions and wait for feedback before installing packages, creating resources, or changing code. If I already approved questions, continue from them.

After agreement, choose the minimum events and bounded properties needed. State exactly when each event fires: an attempt, an accepted request, or a completed outcome. Avoid duplicate client/server tracking. Start with ONE real app action and prove it works before adding the rest.

Use current Counted documentation:
- Quickstart: ${docsOrigin()}/getting-started
- Overview: ${siteOrigin()}/llms.txt
- OpenAPI: ${docsOrigin()}/openapi.json
- Advanced API/auth: ${siteOrigin()}/auth.md
- App: ${consoleOrigin()}
- SDKs: https://github.com/iceglober/counted#packages

For JavaScript, the default path is: create or reuse a project, copy its ingest key, install @counted/sdk, create one Counted({ key }) client, and call track(event, properties). Use @counted/react only when it helps the existing app. The SDK handles batching, retries, duplicate protection, and ephemeral visits. Do not build wrappers, management clients, OAuth flows, or service-key setup just to send events. Other stacks should use their documented SDK. Respect the app's lifecycle; await shutdown() before a short-lived process exits.

Open the project's Overview and confirm the real action appears in Live events. Then verify an Insight answers the approved question. Query automation is optional: when needed, use a narrowly scoped service credential or existing agent authorization and read GET /v1/projects/{projectId}/schema first. Its capabilities and measures describe executable support. An OpenAPI enum alone is not proof a query works. Sum accepts only declared measures, never an arbitrary numeric property name. If a capability is unavailable, report the gap and revise the question with me.

Privacy rules: no analytics cookies, fingerprinting, inferred identities, or persistent SDK-generated user/device identifiers. No emails, names, IPs, tokens, secrets, free-form user content, or personal data in properties; properties are not automatically scrubbed. Prefer route templates over full URLs. Visit IDs stay ephemeral and in memory. Raw account/organization IDs are not automatically anonymous. Only use identify() with a customer-supplied opaque ID for an explicitly approved, supported purpose; reset on logout/user changes. Ingest keys are embeddable and project-scoped. Keep service keys and claim tokens out of browser bundles, URLs, logs, and commits.

Analytics must not break the app. Check duplicate effects, missing configuration, and the actual ingestion receipt, including rejected events. Keep event IDs and timestamps unchanged across manual HTTP retries. Report what was changed and what was verified with real events; never claim success from mocks or accepted schemas alone.

Begin with the questions and identity modes, or the missing-product clarification.`;
}
