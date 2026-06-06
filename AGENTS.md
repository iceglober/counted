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
- **Sessions are ephemeral and in-memory.** No IP storage. GDPR/CCPA-clean without a consent
  banner — that's the whole pitch, so don't quietly undermine it.

When a change touches tracking, attribution, auth, or storage, check it against this list
first. "It would improve the funnel" is not a reason to add a cookie.

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript 6
- **Styling**: Tailwind CSS v4 (CSS-first config via `@theme`)
- **Database**: PostgreSQL + TimescaleDB, Drizzle ORM
- **Auth**: better-auth (magic link + Resend)
- **Billing**: Stripe
- **Package manager**: Bun
- **Deployment**: Railway (Dockerfile), GitHub Actions CI

## Repo structure

```
app/                    Next.js App Router pages and API routes
  (marketing)/          Landing page, pricing (served on www.counted.dev)
  (dashboard)/          App pages behind auth (served on app.counted.dev)
  api/                  API routes (v0 event/query/dashboards/projects, auth, billing)
components/             React components
lib/                    Server utilities (auth, db, query engine, stripe, types)
packages/
  sdk/                  @counted/sdk — vanilla JS event tracking (~3KB)
  react/                @counted/react — React provider + hook
  migrate/              @counted/migrate — Aptabase migration CLI
proxy.ts                Request routing (marketing vs app domain, CORS)
```

## Key patterns

- **Insights** (not widgets/cards): the composable dashboard unit. Each has a type (metric, timeseries, breakdown), a query, and a span.
- **Dashboard layout**: stored as JSONB in the `dashboards` table. Flat list of `InsightLayout` objects.
- **Query engine** (`lib/query-engine.ts`): builds parameterized SQL from `InsightQuery` specs. All user input goes through `$N` placeholders — never interpolate.
- **Auth guard** (`lib/auth-guard.ts`): `requireSession()` and `requireProjectAccess(projectId)` for API routes.
- **Proxy routing** (`proxy.ts`): `www.counted.dev` serves marketing pages only; `app.counted.dev` serves the full app.

## Commands

```bash
bun run dev          # Start dev server (Turbopack)
bun run build        # Production build
bun run typecheck    # TypeScript check
bun run db:push      # Push Drizzle schema to database
bun run db:generate  # Generate Drizzle migration
```

## SDK workspace packages

The app imports `@counted/sdk` as a workspace dependency. SDK must be built before the app:

```bash
cd packages/sdk && bun run build
cd packages/react && bun run build
```

The Dockerfile handles this automatically. CI builds SDKs before typecheck.

## API client (`@counted/api`) — Fern

`lib/openapi.ts` is the single source of truth for the HTTP API. The typed
management-API client is generated from it with Fern:

```bash
bun run api:export     # lib/openapi.ts -> fern/openapi/openapi.json (Fern's input)
bun run api:generate   # export + `fern generate` -> packages/api/generated
```

- `fern/openapi/openapi.json` is committed; the **OpenAPI in sync** CI workflow
  fails a PR if it drifts from `lib/openapi.ts` (run `bun run api:export` and commit).
- **`fern generate` requires Fern auth** — run `fern login` locally, or set a
  `FERN_TOKEN` repo secret for CI. (That's the one step that can't run unauthenticated.)
- Once generated, `packages/api/src/index.ts` should re-export from `./generated`
  (`export * from "../generated"`). Until then it carries hand-written types.
- The human-readable reference at `/docs/api` and the agent summary at `/docs/llms.txt`
  both render straight from `lib/openapi.ts`, so they never drift.

## Environment variables

See `.env.example` for the full list. Key ones:
- `DATABASE_URL` — Postgres connection string
- `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` — auth config
- `TRUSTED_ORIGINS` — comma-separated list of allowed origins
- `RESEND_API_KEY` / `RESEND_FROM` — email sending
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*_ID` — billing
- `NEXT_PUBLIC_COUNTED_PROJECT_KEY` — dog-food analytics tracking

## For maintainers

Internal docs live in a separate private repo. Ask a maintainer for access.
