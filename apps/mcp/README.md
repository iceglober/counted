# `@counted/mcp-server`

MCP tools projected from the contract. This is how an agent uses Counted without
a browser.

## The property this server exists to keep

**There is no MCP-specific authorization path.** A tool call is the caller's own
token on the same HTTP route the console calls; whether it is allowed is decided
once, in `apps/api`, by `packages/authorization`. Tool execution never checks a
permission, a role or a scope — there is no allowlist keyed by identity, no tool
list narrowed by authority, and no call pre-empted because it looks like it would
be refused. `handler.test.ts` asserts this as indistinguishability: two callers
whose tokens can do wildly different things get byte-identical behaviour out of
this server, and the difference appears only in what the API answers.

Discovery advertises the existing permission names needed by exposed tools, so
an OAuth client can request consent. These scopes only narrow access; they never
grant a permission the account's current role does not hold.

The same reasoning decides where token *liveness* is checked. Verifying the
access token's signature locally against the authorization server's JWKS would be
a second place that decides a token is good — and a locally verified but revoked
token would be accepted here and refused by the API, which is one question with
two answers, one of them stale. So this server asks the API (`GET /v1/me`). The
identity adapter validates the token, its resource audience, and its current
consent grant. Every resource request intersects consent scopes with the
account's current workspace role; disconnecting the application revokes access.

## What is exposed, and what is not

`src/exposure.ts` is the marker, with a reason for every procedure that is
withheld. The table decides *which tools exist*, never
*who may call one* — leaving `projects.delete` out does not stop a token
deleting a project over HTTP; it means this server does not hand an agent a
one-word way to do it.

A tool's name, description, argument schema, reply schema, HTTP route and
behavioural hints are all derived from the contract. The input schema is the
contract's schema **object**, passed by reference, so there is no second
description to drift.

## Running it

| Variable | Required | Meaning |
|---|---|---|
| `COUNTED_API_URL` | yes | Base URL of `apps/api`. Every tool call and every identity check goes here. |
| `COUNTED_MCP_RESOURCE` | yes | This server's public URL, which is also its RFC 8707 resource identifier. Its path is the path the MCP endpoint listens on. |
| `COUNTED_OAUTH_ISSUER` | yes | The issuer in the API's discovery document, including `/api/auth`, for example `https://api.counted.dev/api/auth`. |
| `COUNTED_MCP_DOCS_URL` | no | Advertised as `resource_documentation`. |
| `PORT` | no | Default `3002`. |
| `COUNTED_API_TIMEOUT_MS` | no | Default `30000`. |

```
bun run --cwd apps/mcp start
```

The process is `src/main.ts` (`deploy/mcp.Dockerfile` runs it as PID 1; it
stops on `SIGTERM`). Four routes are served:

```
GET  /.well-known/oauth-protected-resource[/path]   RFC 9728 metadata
POST <the resource's path>                          the MCP endpoint
GET  /health                                        liveness
GET  /health/ready                                  readiness — what deploy/mcp.railway.json checks
```

`tests/journey/journey.test.ts` §13 is the end-to-end proof: the server started
this way, pointed at a real API, driven with `@modelcontextprotocol/client` over
Streamable HTTP with a workspace-wide service key.

## What `apps/api` has to hold up its end of

- Mount better-auth's `mcp` plugin with `resource` set to the same value as
  `COUNTED_MCP_RESOURCE`. The API's identity adapter checks that audience before
  resolving a bearer token to an account.
- Accept an MCP access token as a credential on the contract's routes, including
  `GET /v1/me`.

The authorization server discovery document is at
`<COUNTED_API_URL>/api/auth/.well-known/oauth-authorization-server`. Use its
`issuer` value exactly. The console supplies `/consent` and `/oauth/continue`
for the registered client's authorization-code flow with PKCE.
