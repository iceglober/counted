# Deploying Counted v2

Three services and one Postgres. The database has **no TimescaleDB** — v2 uses
plain PostgreSQL, and nothing queries a Timescale function (see
`ARCHITECTURE.md` for why).

```
counted-api      apps/api      Bun + Hono      public   api.counted.dev
counted-web      apps/web      Next.js         public   app.counted.dev
counted-worker   apps/worker   Bun             private  no ingress
counted-db       Postgres 16+  plain           private
```

## Environment, per service

Nothing is shared beyond `DATABASE_URL`. A variable absent from a service's
column is a variable that service must not have — the web app having no
`DATABASE_URL` is the enforced part of "the console holds no privileged path".

| variable | api | web | worker | notes |
|---|:--:|:--:|:--:|---|
| `DATABASE_URL` | ● | | ● | Railway reference: `${{counted-db.DATABASE_URL}}` |
| `PORT` | ● | ● | | set by Railway |
| `RELEASE` | ● | | ● | falls back to `RAILWAY_GIT_COMMIT_SHA` |
| `APP_URL` | ● | | | where the console lives; decides the session cookie's domain and the CORS allowlist |
| `COUNTED_API_URL` | | ● | | server-side calls; may be the private address |
| `NEXT_PUBLIC_COUNTED_API_URL` | | ◐ | | **build argument** — Next inlines it into the client bundle, so changing it needs a rebuild |
| `RESEND_API_KEY` | ● | | ● | api sends sign-in links; worker sends monitor mail |
| `EMAIL_FROM` | ● | | | `Counted <hello@auth.counted.dev>` |
| `NOTIFY_FROM` | | | ● | `alerts@counted.dev` |
| `STRIPE_SECRET_KEY` | ● | | | |
| `STRIPE_WEBHOOK_SECRET` | ● | | | |
| `STRIPE_PRICE_MONTHLY_ID` | ● | | | |
| `STRIPE_PRICE_ANNUAL_ID` | ● | | | |
| `WEBHOOK_SIGNING_SECRET` | | | ● | signs outbound webhooks (Standard Webhooks) |
| `WORKER_INTERVAL_MS` | | | ○ | defaults to 5000 |
| `WORKER_SHARDS` / `WORKER_SHARD_INDEX` | | | ○ | only when running more than one worker |

● required ◐ build-time ○ optional

## Migrations

The schema is applied **by the service at boot**, not by a pre-deploy step.

`migrate()` runs inside `compose()` before anything reads the database. Every
statement is `CREATE … IF NOT EXISTS`, and the whole run is wrapped in a
Postgres advisory lock, so:

- every replica runs it and only the first does any work;
- a redeploy against an unchanged schema is a no-op that logs `migrate.current`;
- eight replicas starting simultaneously produce one schema and no error
  (there is a live test for exactly that).

**Why not a pre-deploy command.** v1 tried one. Railway's one-off container is
not on the service network, so it could not resolve `*.railway.internal`, and
migration failed with `ENOTFOUND` on every deploy — the schema was actually
being applied by the app, silently, which nobody noticed for weeks. Running it
in the process that will serve traffic means it uses the same connection string
it is about to query with.

**A failed migration fails the deploy.** `compose()` throws before the port is
bound, so the container never becomes healthy and Railway keeps the previous
one serving.

## Zero downtime

The API runs two replicas with `overlapSeconds: 30`, so the new deployment is
healthy before the old one is drained.

**Readiness is schema-aware.** `/health/ready` compares the fingerprint this
build expects against what the database reports, and answers `503` when they
differ. During a deploy that adds schema, the old replicas briefly report not
ready — which is correct: they were built against a different schema and should
not take traffic. Railway routes to the new ones.

That is also why the fingerprint is in the readiness body: `curl` on a replica
tells you which schema it is on.

**Draining.** Both Bun services handle `SIGTERM` — the API stops accepting,
finishes in-flight requests and closes its pools; the worker finishes the
current tick and settles its jobs. Neither runs under a shell, so the signal
reaches PID 1 rather than being swallowed.

**Ordering.** Deploy `api` first: it applies the schema, and `web` is a pure
client of it. The worker can go at any point — its jobs are leased, so one
interrupted mid-flight is picked up by the next tick.

**Rollback.** A rollback to a build with an *older* schema fingerprint will
report not-ready, because the database is ahead of it. That is deliberate: the
alternative is a replica quietly serving against a schema it was not built for.
Roll forward, or apply the older schema first.

## Building

Each service has a Dockerfile under `deploy/`. They copy the tree and then trim
the workspace to that service's dependency closure:

```
bun scripts/prune-workspace.ts apps/api && bun install
```

The closure is *computed* from the manifests, not listed — a per-service list
of workspaces is three lists that must agree with `workspaces` in
`package.json`, and the way they go stale is a new package breaking a deploy.
For the API this is 11 workspaces rather than 20; the web image is 2.

> **Local build note.** These have not been built locally: Docker Desktop on
> the development machine is allocated 1.9 GiB and `bun install` is OOM-killed
> (exit 137). Raise Docker → Settings → Resources → Memory to ~6 GiB to build
> them here. Railway's builders are not so constrained.
