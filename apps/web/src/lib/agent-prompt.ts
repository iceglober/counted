import { consoleOrigin } from "./env";
import { docsOrigin, siteOrigin } from "./site";

export function agentPrompt(): string {
  return `Help me evaluate and integrate Counted into this app.

Counted is open-source, self-hostable, privacy-first product analytics. Custom events and properties become counts, time series, breakdowns, and ordered visit funnels. Dashboards are composed of Insights. Counted also has an API, API Explorer, and MCP interface.

First, establish which product we are discussing. If you can access a repository in the current working directory, read its instructions and inspect just enough of its overview, routes, and existing analytics to understand the product and its main user journeys. Avoid an exhaustive codebase audit before your first recommendation.

If the current directory contains no recognizable product or repository, or you cannot access local files, say so and ask for the repository path, a product URL, or a short product description and its audience. Do not search unrelated directories or assume the current folder is the product. With only a URL or description, you can still propose questions, but label assumptions and defer code-specific setup until source access is available. If multiple products are plausible and the context does not identify one, ask which to focus on.

Your first substantive response should briefly describe the product as you understand it, then propose 3–5 plain-language questions Counted can answer about it. Use language a product owner would use, not event names, API vocabulary, or a technical implementation plan. Ground each question in the product and verify any uncertain capability against current Counted documentation. Do not invent a product just to fill this list.

Mark every question with exactly one identity mode, choosing the least identifying mode that answers it:
- [Anonymous visits]: answerable from events and ephemeral visits, optionally grouped by non-identifying categories such as organization type, plan, or role. This does not count unique people or recognize someone across visits. A successful login count, actions within a visit, and estimated active time do not inherently require a person ID.
- [Identified users]: requires recognizing the same person across visits using an opaque identifier explicitly supplied by the customer through identify(). Explain in one short sentence why the question needs it. This is pseudonymous personal data when the customer can link the ID to a person; Counted does not anonymize that ID. This mode does not by itself make an unsupported analysis available.

Tailor questions like “Which types of organizations use the app most?”, “What do people do during a visit?”, or “How many people come back on another day?” to the actual product, specifying visits, logins, or distinct people. An organization-type breakdown does not require identity. A raw organization ID needs a separate purpose and privacy assessment; it is not automatically anonymous.

End that response by asking me to accept, remove, rewrite, or add questions, and wait for my feedback. Do not install packages, create resources, change code, or produce a detailed event catalog before we agree on the questions. If I already supplied or approved questions, refine and label those instead of restarting discovery. Do not force identified-user questions into a product that only needs anonymous measurement.

After we agree on the questions, map each to the necessary events, properties, identity mode, and supported Insight. Give precise firing conditions and actual code locations. Distinguish attempts, accepted requests, and completed outcomes; avoid duplicate client/server events. Prefer route templates and bounded properties. State measurement limitations, and do not promise retention or other unsupported analyses merely because identity is available.

Use current documentation before choosing packages or writing API calls:
- Overview: ${siteOrigin()}/llms.txt
- Getting started: ${docsOrigin()}/getting-started
- Generated OpenAPI: ${docsOrigin()}/openapi.json
- Authentication and MCP: ${siteOrigin()}/auth.md
- App: ${consoleOrigin()}
- Source and SDKs: https://github.com/iceglober/counted

Once the measurement plan is agreed, use the smallest suitable integration: the JavaScript SDK (@counted/sdk), optionally its React integration (@counted/react), or the documented SDK/HTTP API for another stack. Reuse a suitable project or guide project/key creation using current docs. For self-hosting, follow the setup guide and verify service URLs. Keep product analytics separate from coding-agent telemetry.

Keep the integration privacy-first: no analytics cookies, fingerprinting, or SDK-invented persistent user/device identifiers. Do not send emails, names, IP addresses, tokens, sensitive domain data, free-form user content, raw query strings, or secrets as event properties. Properties are not automatically scrubbed for personal data. SDK visits are ephemeral and held in memory; stored events still follow the project's retention policy. Never derive a person's identity. Only use identify() with an opaque customer-supplied ID when we explicitly choose identified-user measurement, and reset on sign-out or a change of user. An ingest key is project-scoped and embeddable; service credentials and claim tokens must stay private and out of browser bundles, URLs, logs, and commits.

Keep login events, visits, and people distinct. Where needed, the SDK's initial visitId option can correlate a controlled first-party server-to-browser handoff without a durable person ID. Use a fresh ephemeral value, never an authentication session ID or one-time ticket, and validate the actual handoff rather than assuming every sign-in provider behaves alike. Do not create cross-site tracking identifiers or treat a URL fragment as secret. For active-time questions, measure visible, recently interactive elapsed time, handle idle/background transitions, and describe the result as an estimate rather than attention.

Follow existing configuration and lifecycle conventions. Analytics must not break the user's action. Handle SPA navigation, duplicate effects, retries, and flushing before short-lived processes exit. Preserve event identifiers and timestamps across HTTP retries; inspect accepted, deduplicated, rejected, and per-event outcomes rather than treating every 202 as success.

Verify an actual app action end to end: safe properties, ingestion receipt, query, and an Insight answering the agreed question. Test duplicate prevention and missing configuration. Report changes, verified behavior, and remaining setup separately. Never claim integration success from mocks alone.

Begin with the 3–5 human-readable questions and their identity modes, or the missing-product clarification when there is not enough context. Ask only for product context or access you cannot determine from the app.`;
}
