// Machine-readable homepage view (rendered for /?mode=agent): endpoints, auth,
// and capabilities instead of marketing HTML.
export function AgentView() {
  return (
    <div className="page">
      <h1>Counted — agent view</h1>
      <p>
        Privacy-first product analytics. Machine-readable summary for agents. Full
        index: <a href="/llms.txt">/llms.txt</a> · OpenAPI:{" "}
        <a href="/openapi.json">/openapi.json</a> · Auth: <a href="/auth.md">/auth.md</a>
      </p>

      <h2>API</h2>
      <ul>
        <li><b>Base URL:</b> <code>https://app.counted.dev/api/v0</code></li>
        <li><b>Provision a key (no signup):</b> <code>POST /api/v0/provision</code> → <code>ck_</code> client key + claim link</li>
        <li><b>Ingest an event:</b> <code>POST /api/v0/event</code> (header <code>Project-Key: ck_…</code>)</li>
        <li><b>Query metrics:</b> <code>POST /api/v0/query</code> (header <code>Authorization: Bearer sk_…</code>)</li>
        <li><b>OpenAPI:</b> <code>https://counted.dev/openapi.json</code></li>
      </ul>

      <h2>Auth</h2>
      <ul>
        <li>API keys. <code>ck_</code> = write-only client key (mintable with no signup). <code>sk_</code> = server key, sent as a Bearer token, for reads.</li>
        <li>Discovery: <code>/.well-known/oauth-protected-resource</code> · walkthrough: <code>/auth.md</code></li>
        <li>Errors are JSON: <code>{`{ "error": "…" }`}</code> with a 4xx status.</li>
      </ul>

      <h2>Capabilities</h2>
      <ul>
        <li>Track product events; build funnels, breakdowns, time series, and dashboards.</li>
        <li>Instrument AI coding agents (tool calls, file edits, outcomes) into an eval dashboard.</li>
        <li>Import history from Aptabase via the <code>@counted/migrate</code> CLI.</li>
      </ul>

      <h2>SDKs (npm)</h2>
      <ul>
        <li><code>@counted/sdk</code>, <code>@counted/react</code>, <code>@counted/claude-code</code>, <code>@counted/opencode</code>, <code>@counted/migrate</code></li>
      </ul>

      <h2>Pricing</h2>
      <p>Free: 100K events/mo. Pro: $12/mo for 1M. Machine-readable: <a href="/pricing.md">/pricing.md</a></p>
    </div>
  );
}
