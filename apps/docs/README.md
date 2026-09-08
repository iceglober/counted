# Counted documentation

The public site for `docs.counted.dev`. A standalone Next.js app with a Scalar
reference and Counted's shared UI theme. It needs no API connection, database,
auth secret, or runtime credential.

```sh
bun run docs:dev      # http://localhost:3001
bun run docs:build    # regenerate OpenAPI, then build the standalone server
```

`bun run dev` starts it alongside the API and console. Override its port with
`DOCS_PORT`. Regenerate with `bun run openapi:generate` after editing a contract
while a development server is running. Both production app builds regenerate
before bundling, and CI checks the committed document for drift.

`packages/contract` → oRPC OpenAPIGenerator → root `openapi.json` →
`@counted/openapi` → the docs reference and the console's generated forms.
`GET /openapi.json` serves the generated operations and schemas as an OpenAPI 3.1
file, with its public server URL set for the current deployment.

The reference covers every oRPC operation and the ingestion schema shared with
the dedicated group-commit handler. Ingestion also has generated forms in the
Explorer. Provider authentication remains under `/api/auth/` and is available
through Custom request mode; Stripe webhooks remain server-to-server. These
transports are not replaced by the reference.

## Deployment URLs

Configure public HTTP(S) origins, without credentials, on the running docs service:

| Variable | Hosted default | Used for |
| --- | --- | --- |
| `COUNTED_DOCS_URL` | `https://docs.counted.dev` | Canonical URLs, sitemap and robots |
| `COUNTED_CONSOLE_URL` | `https://app.counted.dev` | API Explorer and project claim links |
| `COUNTED_PUBLIC_API_URL` | `https://api.counted.dev` | Request examples and OpenAPI `servers` |

URLs are read per request. The same built image works on hosted or self-hosted
domains; restart with new environment values without rebuilding. An internal
`COUNTED_API_URL` is never used as a public destination or contacted by this app.
The [self-host Compose setup](../../self-host/README.md) supplies these from
`DOCS_URL`, `BASE_URL`, and `API_URL` and passes the public docs/API URLs to the
console as well.

The public reference does not send live requests: management routes have no
cross-origin browser access. Its Explorer link opens the authenticated app,
which forwards the caller's existing session or entered API key. Scalar assets
are bundled locally; its remote fonts, telemetry, AI agent, generated MCP
promotion, and credential persistence are disabled.

Deployment uses `deploy/docs.Dockerfile` and `deploy/docs.railway.json`. See
`deploy/README.md` for service setup and the production workflow switch.
