# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Counted, please report it responsibly.

**Email**: austin@iceglobe.io

**Do NOT** open a public issue for security vulnerabilities.

We will acknowledge receipt within 48 hours and provide an initial assessment within 7 days. We aim to release a fix within 30 days of confirmation.

## Scope

- Event ingestion API (`/api/v0/event`)
- Authentication and session management (better-auth)
- Query engine (SQL injection, authorization bypass)
- Dashboard data access (cross-project data leakage)
- SDK packages (`@counted/sdk`, `@counted/react`)

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
