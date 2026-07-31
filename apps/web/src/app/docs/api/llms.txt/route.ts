import { text } from "@/lib/agent-meta";

// Section-scoped llms.txt for the API area (modular per-product-area index).
const CONTENT = `# Counted API

> Scoped agent context for the Counted HTTP API. Full site index: https://counted.dev/llms.txt

- OpenAPI spec: https://counted.dev/openapi.json
- Base URL: https://app.counted.dev/api/v0
- Auth: https://counted.dev/auth.md  (API keys: ck_ client, sk_ server Bearer)

## Endpoints
- POST /provision — mint a write-only client key, no signup.
- POST /event — ingest one event or a batch of up to 50 (client key).
- POST /query — counts, breakdowns, time series, funnels (server key, Bearer).
- GET  /events — recent events (server key).
- API reference (human): https://counted.dev/docs/api
`;

export function GET() {
  return text(CONTENT);
}
