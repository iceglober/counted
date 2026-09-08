# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Counted, please report it responsibly.

**Email**: austin@iceglobe.io

**Do NOT** open a public issue for security vulnerabilities.

We will acknowledge receipt within 48 hours and provide an initial assessment within 7 days. We aim to release a fix within 30 days of confirmation.

## Scope

- Event ingestion API (`POST /v1/events`)
- Authentication, sessions and machine credentials (better-auth)
- Authorization (the grant table, bindings, credential scopes) and the query engine
- Dashboard and analytics data access (cross-project or cross-workspace leakage)
- The MCP server (`apps/mcp`) and its OAuth resource metadata
- SDK packages (`@counted/sdk`, `@counted/react`, and the Python, Go and Rust SDKs)

## Out of Scope

- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report upstream)
- Self-hosted deployments with misconfigured infrastructure

## Privacy Guarantees

These are treated as security-critical invariants:

1. The server never stores IP addresses from event ingestion
2. The SDK never sets cookies or uses localStorage for tracking
3. The SDK never fingerprints browsers
4. Event properties are never shared with third parties
5. The SDK source code is fully auditable

A violation of any of these is a critical security issue.

## Authentication and privacy

Console accounts are separate from customer analytics. Account records contain
email, display name and verification state; password sign-in stores a password
hash. Authentication uses necessary cookies to maintain a login and to secure
the sign-in flow. These cookies are not analytics identifiers.

When configured, Google sign-in requests `openid email profile`; GitHub requests
`read:user user:email`. The chosen provider learns that you are signing in to
Counted. The identity adapter stores the provider account ID, returned profile
details and OAuth tokens to support that sign-in method. It does not share
customer analytics with the sign-in provider. Automatic linking to an existing
same-email account requires both the existing account and provider email to be
verified.

Console sessions omit IP addresses and user-agent strings. Sign-in abuse checks
use an address only in expiring memory counters, never a database key or durable
address-derived identifier. Counters are per API process and reset on restart.
SDK visits remain in memory on the client; events carry their visit ID, and
Counted never derives a person identity from an address, device or visit.
