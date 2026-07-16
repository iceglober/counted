import { markdown } from "@/lib/agent-meta";

// Agent auth walkthrough (WorkOS auth.md shape: Discover / Pick a method /
// Register / Claim / Use / Errors / Revocation). Documents Counted's REAL flow:
// the provision endpoint mints a write-only key with no human in the loop, and
// server keys are Bearer tokens. We describe only endpoints that actually
// resolve — no advertised URIs that 404.
const CONTENT = `# Authenticating with Counted (agent guide)

Counted uses **API keys**, not OAuth. There are two key types:
- **Client key** (\`ck_\`) — write-only, safe to ship in a browser or an agent.
  Can ingest events; cannot read data.
- **Server key** (\`sk_\`) — full read/write. Send it as a Bearer token. Keep it
  secret (server-side or an agent's secret store).

Discovery metadata: https://counted.dev/.well-known/oauth-protected-resource

## Discover
The resource server is \`https://app.counted.dev\`. Read endpoints answer an
unauthenticated request with \`401\` and a hint:
\`\`\`
WWW-Authenticate: Bearer resource_metadata="https://counted.dev/.well-known/oauth-protected-resource"
\`\`\`

## Pick a method
- **Anonymous provisioning (recommended for agents).** No account, no human.
  The provision endpoint returns a client key you can start sending events with
  immediately, plus a claim link a human can open later to own the dashboard.
- **Server key.** For reading metrics, a human creates a server key in the
  dashboard (Projects → keys) and hands it to the agent.

## Register / Claim
Mint a client key with no signup (this is the \`register_uri\`-equivalent):
\`\`\`
curl -X POST https://app.counted.dev/api/v0/provision
# -> { "clientKey": "ck_...", "claimUrl": "...", "dashboardUrl": "..." }
\`\`\`
Give \`claimUrl\` to the human to claim ownership of the project. The key keeps
working before and after claiming.

## Use the credential
- Ingest with the client key:
\`\`\`
curl -X POST https://app.counted.dev/api/v0/event \\
  -H "Project-Key: ck_..." -H "Content-Type: application/json" \\
  -d '{"eventName":"signup","sessionId":"<id>","props":{"plan":"pro"}}'
\`\`\`
- Read with a server key (Bearer):
\`\`\`
curl -X POST https://app.counted.dev/api/v0/query \\
  -H "Authorization: Bearer sk_..." -H "Content-Type: application/json" \\
  -d '{"projectId":"...","measure":"count"}'
\`\`\`

## Errors
Every error is JSON: \`{ "error": "<message>" }\` with a 4xx status. Common cases:
- \`400\` — malformed body or invalid event (e.g. bad timestamp).
- \`401\` — missing/invalid key on a read endpoint (carries the WWW-Authenticate hint).
- \`403\` — wrong key type (e.g. an \`sk_\` key sent to ingest, or over-quota).

## Revocation
Rotate or revoke a key in the dashboard (Projects → keys → Rotate). Rotating
immediately invalidates the old key. There is no separate revocation endpoint;
key lifecycle is managed in the dashboard.
`;

export function GET() {
  return markdown(CONTENT);
}
