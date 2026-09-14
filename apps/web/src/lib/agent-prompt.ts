import { consoleOrigin } from "./env";
import { docsOrigin, siteOrigin } from "./site";

export function agentPrompt(): string {
  return `Help me evaluate and integrate Counted into this app.

Counted is open-source, self-hostable, privacy-first product analytics. It records custom events and properties, then turns them into counts, time series, property breakdowns, and ordered visit funnels. Dashboards are composed of rearrangeable, resizable Insights. It also has an API, an API Explorer, and an MCP interface.

Start by exploring my repository. Read its instructions, identify the stack, understand the product and its main user journeys, and find existing analytics, event handlers, server actions, and background jobs. Explain what Counted could help us learn about this particular app. Reference actual routes, components, and code paths rather than inventing generic usage examples.

Recommend a small, useful measurement plan:
- Prioritize activation, successful outcomes, drop-off, repeat usage within a visit, and operational failures where relevant.
- For each proposed event, give its name, precise firing condition, safe properties, implementation location, and the product question it answers. Distinguish attempts from successful completion; avoid double-counting the same action on client and server.
- Suggest an initial dashboard of Insights: counts for headline outcomes, time series for trends, breakdowns by useful properties, and ordered visit funnels for multi-step journeys. Use the chosen property names as labels. Prefer route templates and bounded categories over raw URLs or unbounded values.
- Call out what the available signals cannot establish. Do not promise cross-device identity, person-level retention, or unsupported analyses.

Use current documentation before choosing packages or writing API calls:
- Overview: ${siteOrigin()}/llms.txt
- Getting started: ${docsOrigin()}/getting-started
- Generated OpenAPI: ${docsOrigin()}/openapi.json
- Authentication and MCP: ${siteOrigin()}/auth.md
- App: ${consoleOrigin()}
- Source and SDKs: https://github.com/iceglober/counted

Once we agree on the measurement plan, use the smallest integration that fits this stack. For JavaScript, the base SDK is @counted/sdk; add @counted/react only when its React integration is useful. Other stacks should use their documented SDK or the HTTP API. Reuse an existing configured project when appropriate. Otherwise, guide me through creating a project and ingest key; consult the docs if anonymous provisioning and later claiming would fit better. For self-hosting, follow the repository's setup guide and verify the service URLs. Do not confuse instrumentation of this app with coding-agent telemetry; suggest the latter separately only if relevant.

Keep the integration privacy-first: no analytics cookies, persistent visitor identifiers, fingerprinting, or personal data. Do not send emails, names, IP addresses, tokens, free-form user content, raw query strings, or secrets as event properties. SDK visits are ephemeral and held in memory. Never derive a person's identity; identify() may only receive an opaque customer-supplied identifier when explicitly needed. An ingest key is project-scoped and embeddable; service credentials and claim tokens must stay private and out of browser bundles, URLs, logs, and commits.

Follow this app's existing configuration, lifecycle, and error-handling conventions. Analytics must not break the user's action. Account for SPA navigation, duplicate effect execution, background jobs, retries, and flushing before short-lived processes exit. Preserve event identifiers when retrying HTTP ingestion and inspect accepted, deduplicated, rejected, and per-event outcomes rather than treating every 202 response as success.

Verify one representative event end to end: trigger the actual app action, confirm its safe properties and receipt, query it or inspect it in Counted, then confirm the corresponding Insight answers the intended question. Test duplicate prevention and disabled/missing configuration. Report what you changed, what you verified, and any remaining setup I need to complete. Never claim success from a mocked request alone.

Begin with a concise, repository-specific recommendation and the highest-value first few events. Ask only for product context or access you cannot determine from the app.`;
}
