# Working in this repo

## Philosophy — privacy-first, no cookies

This is the core principle the whole product is built on, and it constrains how we build:

- **No cookies. No fingerprinting. No PII.** This holds for the product *and* for our own
  analytics — Counted dogfooding Counted must obey the same rules we sell.
- **No cross-site tracking identifiers, ever.** Don't introduce a cookie or a shared
  cross-domain identifier to stitch a user across `counted.dev` and `app.counted.dev`. If a
  flow seems to need one (e.g. attribution), solve it another way (first-party `localStorage`
  for a *first-party* value, URL params explicitly forwarded on a click, server-side joins) —
  or leave the gap and flag it. The privacy stance wins over the metric.
- **`localStorage` only for first-party, non-identifying values** — preferences, a first-touch
  channel, an A/B bucket. Never a stable user/device identifier.
- **The actor is the visit, not the person.** IP addresses are never stored: a country is
  derived at the edge and the address is discarded. GDPR/CCPA-clean without a consent
  banner — that's the whole pitch, so don't quietly undermine it.

When a change touches tracking, attribution, auth, or storage, check it against this list
first. "It would improve the funnel" is not a reason to add a cookie.

## Stack

- **Runtime and package manager**: Bun 1.3.14. Workspace packages point `main` at
  TypeScript source; nothing is built to run locally.
- **API**: Hono + oRPC v2. The contract in `packages/contract` is the single source of
  truth; `openapi.json` and every SDK's generated types come from it and CI fails on drift.
- **Console**: Next.js under `apps/web`, a pure client of the contract (a test forbids
  hand-written response shapes).
- **Worker**: `apps/worker` — monitors, retention, the analytics compactor, reconciliation.
- **MCP**: `apps/mcp` projects the contract into tools for agents, OAuth 2.0 bearer auth.
- **Docs**: `apps/docs` serves the generated OpenAPI reference and integration guide.
- **Auth**: better-auth (magic link, email/password, organizations, machine credentials).
- **Analytics engine**: litics (`@litics/core`, `@litics/compactor`), vendored under
  `vendor/` from the sibling `iceglober/litics` repository and consumed in-process.
- **Database**: plain PostgreSQL 14+ with nothing installed — Neon, Supabase, RDS, or the
  official image. There is no extension anywhere; CI asserts that `pg_extension` holds one row.
- **Billing**: Stripe. **Deployment**: Railway from `deploy/*.Dockerfile`, GitHub Actions.

## Repo structure

```
apps/api, apps/web, apps/worker, apps/mcp, apps/docs
                                           the five deployables
packages/<context>/{domain,ports,app,adapter-*}
                                           bounded contexts: analytics, dashboarding, identity,
                                           ingestion, projects, tenancy, billing …
packages/contract                          the oRPC contract, error vocabulary, schemas
packages/adapters/postgres                 the domain schema, migrations, repositories
packages/sdk-js, react, python, go, rust   client SDKs (generated contract types inside)
vendor/litics-core, vendor/litics-compactor  the analytics engine (do not edit; re-vendor)
tests/journey                              one customer, start to finish, over real HTTP
deploy/                                    Dockerfiles, Railway configs, the runbook
```

`.dependency-cruiser.cjs` enforces the layering (domains import nothing, apps are
independent, only `packages/analytics/adapter-litics` may import litics). `bun run arch`
runs it.

## Commands

```bash
bun run dev              # database + API + console, one command (scripts/dev.sh)
bun run typecheck        # the whole workspace, tests included
bun run arch             # dependency rules
bun run test             # unit suites (in-memory doubles)
bun run journey          # end to end, needs `docker compose up -d db`
bun run openapi:check    # openapi.json is current
bun run contract:check   # every generated SDK artefact is current
bun scripts/vendor-litics.ts   # refresh vendor/ from ../litics (clean tree only)
```

## Key patterns

- **Failures are values.** Ports return `Result`s and typed outcomes; an engine failure never
  becomes an empty chart. Read `packages/analytics/ports` before adding a query.
- **Every write surface is a contract procedure first.** A console button or an MCP tool is a
  projection of the contract, never a route of its own.
- **Generated migrations are ledgered.** litics' DDL and any change to an existing domain
  table are named steps applied once under one advisory lock; boot refuses to serve on drift.
- **Tests beside code**, `bun:test`, doubles in memory; anything that needs Postgres uses the
  `describeLive` helper and `COUNTED_TEST_DATABASE_URL`.

## Environment variables

`.env.example` is the reference and is loaded by `scripts/dev.sh`; each service reads its
environment once at boot and prints every problem before exiting. `deploy/README.md` has the
per-service table.

## Where to read next

- `DEVELOPING.md` — setup, the three schemas, the journey suite, resetting.
- `deploy/README.md` — services, environment, migrations, zero downtime, the restore drill.
- `self-host/README.md` — running it yourself.
