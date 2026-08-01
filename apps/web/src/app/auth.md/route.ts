import { API_URL, SITE_URL } from "../../lib/urls";

/**
 * `/auth.md` — how an agent gets a credential, in prose.
 *
 * Written to describe what Counted actually does, not what an audit checklist
 * would like it to do. Counted has no OAuth authorization server and no
 * dynamic client registration, so this says so plainly instead of advertising
 * `register_uri` and `claim_uri` endpoints that would 404 on the first call.
 * A discovery document naming endpoints that do not resolve is worse than no
 * document: it turns "look elsewhere" into "this is broken".
 *
 * What Counted does have is unusually good for an agent — `/v1/provision`
 * takes no credential and returns one — and that is the story worth telling.
 */
export const dynamic = "force-static";
export const revalidate = 86_400;

const body = `# Authenticating with Counted

Counted uses bearer credentials scoped per project. There is no OAuth
authorization server, no client registration step, and no consent screen — an
agent can obtain a working credential in one unauthenticated request.

## Discover

Protected-resource metadata (RFC 9728) is published on the API host:

    GET ${API_URL}/.well-known/oauth-protected-resource

Every \`401\` from the API also carries the pointer, so one failed call is
enough to find this:

    WWW-Authenticate: Bearer realm="counted", scope="events:write",
      resource_metadata="${API_URL}/.well-known/oauth-protected-resource",
      error="invalid_token"

The full contract is at [${API_URL}/v1/openapi.json](${API_URL}/v1/openapi.json).

## Pick a method

There are two kinds of credential, and they are not interchangeable.

**Ingest credential** (\`ck_…\`) — public, safe to ship in a client bundle or a
mobile app. Carries exactly one scope, \`events:write\`. It cannot read data.
Presenting one to a query endpoint returns \`403\` with a body that names the
missing scope.

**Service credential** — secret, server-side only. Carries the scopes you grant
it, such as \`queries:run\` or \`projects:read\`. Never put one in a browser.

Choose the ingest credential for sending events. Choose a service credential
only when the task genuinely needs to read data back.

## Register

No registration. \`POST ${API_URL}/v1/provision\` accepts no credential and
returns a project plus an ingest key:

    curl -X POST ${API_URL}/v1/provision \\
      -H 'content-type: application/json' -d '{}'

The response contains \`ingestKey\` and a \`claimUrl\`. The project is created in
an \`unclaimed\` state and works immediately for ingestion.

## Claim

The \`claimUrl\` in the provision response hands the project to a human account.
It expires after seven days. An agent does not need to claim anything to send
events — claiming is how a person takes ownership of what the agent created.

## Use the credential

Send it in the Authorization header. This is the only supported method; there
is no query-parameter form, deliberately, because URLs end up in logs.

    curl -X POST ${API_URL}/v1/events \\
      -H "Authorization: Bearer $COUNTED_KEY" \\
      -H 'content-type: application/json' \\
      -d '{"events":[{"name":"page_view","occurredAt":"2026-01-01T00:00:00Z",
           "visitId":"…","properties":{"path":"/pricing"}}]}'

A \`202\` means the batch is committed and durable — not merely queued.

## Errors

Every error is \`application/problem+json\` (RFC 9457) with a stable \`code\`, a
\`requestId\`, and a \`docs\` link.

- \`401 auth.unauthenticated\` — no credential, or it resolves to nothing.
- \`403 auth.forbidden\` — the credential is valid but lacks the scope. The
  \`detail\` names the scope required.
- \`429\` — includes \`Retry-After\`. Honour it; the SDKs do.
- \`503\` — the store is unavailable. Retry with backoff; events are not lost if
  your client queues them.

A credential error disables the official SDKs rather than retrying forever.

## Rotation and revocation

Credentials are many-per-project and rotate by overlap: create the new one,
deploy it, then delete the old one. Both work in the window between, so
rotation needs no downtime.

    POST   ${API_URL}/v1/projects/{projectId}/credentials
    POST   ${API_URL}/v1/projects/{projectId}/credentials/{credentialId}/rotate
    DELETE ${API_URL}/v1/projects/{projectId}/credentials/{credentialId}

Deleting a credential takes effect immediately.

## Sandbox

There is no separate sandbox host. \`/v1/provision\` is the equivalent: it costs
nothing, needs no account, and creates a throwaway project you can send test
events to without touching anything real. Discard it when you are done.

---

Human documentation: <${SITE_URL}/docs/api>
`;

export function GET(): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
