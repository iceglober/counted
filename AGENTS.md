# Working in this repo

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

## Environment variables

See `.env.example` for the full list. Key ones:
- `DATABASE_URL` — Postgres connection string
- `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` — auth config
- `TRUSTED_ORIGINS` — comma-separated list of allowed origins
- `RESEND_API_KEY` / `RESEND_FROM` — email sending
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*_ID` — billing
- `NEXT_PUBLIC_COUNTED_APP_KEY` — dog-food analytics tracking

## For maintainers

Product planning, financial models, roadmap, and operational docs live in a separate private repo: **iceglober/counted-internal**. This includes:

- `ROADMAP.md` — prioritized feature roadmap
- `DESIGN.md` — technical design document
- `financial-model.ts` — CLI financial model (`bun financial-model.ts`)
- `visualizer.html` — interactive financial dashboard (open in browser)

Do not commit business strategy, pricing decisions, competitive analysis, or financial data to this public repo.
