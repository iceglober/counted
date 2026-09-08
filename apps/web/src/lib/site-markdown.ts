import { PUBLIC_PLANS } from "./public-content";
import { consoleOrigin } from "./env";
import { docsOrigin, publicApiOrigin, siteOrigin } from "./site";
export function overviewMarkdown(): string {
  return `# Counted

Privacy-first product analytics. Custom events, counts, time series, property breakdowns, ordered funnels, and composable dashboards made up of Insights.

The SDK holds an ephemeral visit id in memory, without tracking cookies or fingerprinting. Events carry that visit id. Counted never derives person identity; identify() accepts only an opaque identifier supplied by the customer. Do not send personal data in event properties.

## Get started

Install @counted/sdk version 2. Create an ingest key in your project, then:

\`\`\`ts
import { Counted } from "@counted/sdk";
const counted = new Counted({ key: "YOUR_INGEST_KEY" });
counted.track("page_view", { path: "/pricing" });
await counted.flush();
\`\`\`

For anonymous provisioning, POST ${publicApiOrigin()}/v1/projects/provision with an optional name. Keep the returned claim token private; paste it and the project ID at ${consoleOrigin()}/claim when you are ready to adopt the project into a workspace.

- [Get started](${docsOrigin()}/getting-started)
- [API reference](${docsOrigin()})
- [OpenAPI 3.1](${docsOrigin()}/openapi.json)
- [Authentication](${siteOrigin()}/auth.md)
- [Pricing](${siteOrigin()}/pricing.md)
- [Agent integrations](${siteOrigin()}/for/agents)
- [Source and SDKs](https://github.com/iceglober/counted)

The hosted app is at ${consoleOrigin()}. Counted is MIT-licensed and self-hostable on plain PostgreSQL.
`;
}
export function authMarkdown(): string {
  return `# Authenticating with Counted

Use Authorization: Bearer with an appropriate credential. Never put a key or claim token in a URL.

## Ingest keys

Public, embeddable, events:write only, and limited to one project. POST ${publicApiOrigin()}/v1/events with an events array. The 202 receipt reports accepted, deduplicated, and rejected events; inspect per-event outcomes. A successful response can still contain rejected events.

The SDK keeps a visit id in memory. Every event should have its own idempotencyKey and occurredAt; preserve both when retrying. A repeated key and timestamp in the same project is deduplicated after a successful commit.

## Service keys

Secret credentials for API access. Keep them on a trusted server or in a credential manager, never in a browser bundle. Access is limited by the key’s permissions, project or workspace scope, and the issuing member’s role. Create, rotate, and revoke keys from a project’s Keys page or the API.

## Accounts and agent authorization

The console supports email/password sign-in. Email-link sign-in requires configured transactional email. Social sign-in appears only when its provider is configured. Necessary cookies authenticate console sessions; they are not analytics identifiers. API Explorer can use your signed-in session or a key you enter temporarily.

For MCP, use the configured server’s OAuth authorization flow or an appropriately scoped service credential. The hosted MCP endpoint is https://mcp.counted.dev/mcp.

### Discover OAuth endpoints

An unauthenticated MCP request returns HTTP 401 with a WWW-Authenticate header pointing to [OAuth protected-resource metadata](https://mcp.counted.dev/.well-known/oauth-protected-resource/mcp). Read resource, authorization_servers, and scopes_supported from that document.

The hosted issuer is ${publicApiOrigin()}/api/auth. Its [authorization-server metadata](${publicApiOrigin()}/.well-known/oauth-authorization-server/api/auth) supplies authorization_endpoint, token_endpoint, registration_endpoint, revocation_endpoint, and code_challenge_methods_supported. The [issuer-relative metadata URL](${publicApiOrigin()}/api/auth/.well-known/oauth-authorization-server) serves the same document.

### Authorize and use an access token

Register a public OAuth client at registration_endpoint with your exact redirect URI and token_endpoint_auth_method set to none. Start the authorization-code flow using the discovered authorization_endpoint, a random state, resource=https://mcp.counted.dev/mcp, a fresh PKCE verifier and its S256 challenge. Request only the permissions needed, for example queries:run and projects:read. The user signs in and approves the requested access; never collect their password in your integration.

Verify state when the browser returns to your registered redirect URI. Exchange the code at token_endpoint with the same redirect URI, resource, and code_verifier. Send the resulting access token in Authorization: Bearer to the MCP endpoint. Request offline_access only when renewal is needed; keep any returned refresh token in a credential store.

### Errors and revocation

On HTTP 401, follow the WWW-Authenticate challenge to renew authorization. A permission denial requires the appropriate grant and workspace role. A temporary HTTP 503 is a service failure; retry with backoff instead of prompting the user to sign in again. Disconnect an integration in Account settings → Connected applications to revoke its consent and tokens, or use the discovered revocation_endpoint with the client’s registered authentication method.

## Provision and claim

POST ${publicApiOrigin()}/v1/projects/provision needs no account and returns a project, an ingest key, and an expiring claim grant. It is subject to anonymous quotas and expiration. Claim at ${consoleOrigin()}/claim, or POST /v1/projects/{projectId}/claim with the grant and authority to create projects in the destination workspace. The grant does not replace workspace authorization.

See the [generated API reference](${docsOrigin()}) for exact routes, request fields, authorization, and errors.
`;
}
export function pricingMarkdown(): string {
  return `# Counted pricing

Published hosted prices in USD, flat per workspace. No per-member charge.

${PUBLIC_PLANS.map(plan => `## ${plan.name} — $${plan.monthlyUsd}/month${plan.annualUsd ? ` or $${plan.annualUsd}/year` : ""}

- ${plan.eventsPerMonth.toLocaleString("en-US")} events per month
- ${plan.projects ?? "Unlimited"} projects
- ${plan.retentionDays} days event retention
- Unlimited members
`).join("\n")}
Both plans include SDKs, API access, dashboards, counts, time series, property breakdowns, and ordered funnels. Settings → Plan and checkout show the current configured charge, taxes, and discounts before subscription.

Counted is open source and self-hostable. Self-hosted billing and plan configuration are deployment-specific.

Above 1,000,000 events per month: hello@counted.dev.

[Human-readable pricing](${siteOrigin()}/pricing)
`;
}
export function markdownResponse(body: string, type = "text/markdown"): Response {
  return new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
}
