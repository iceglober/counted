# Self-hosting Counted

Run Counted on your own infrastructure with Docker Compose: the API, the
console, worker, documentation, MCP server, and a stock Postgres.

## Quick start

```bash
git clone https://github.com/iceglober/counted.git
cd counted/self-host
cp .env.example .env
```

Edit `.env`:

```bash
COUNTED_AUTH_SECRET=$(openssl rand -hex 32)
BASE_URL=https://analytics.example.com      # the console
API_URL=https://api.analytics.example.com   # the API, reachable from browsers
DOCS_URL=https://docs.analytics.example.com # the documentation
MCP_URL=https://mcp.analytics.example.com/mcp
POSTGRES_PASSWORD=a-strong-password
```

Start:

```bash
docker compose up -d --build
```

The console is at `http://localhost:3000` and the API at
`http://localhost:8080`; documentation is at `http://localhost:3001` and MCP at
`http://localhost:3002/mcp`. The API applies the whole schema on its first boot —
no manual `psql`, and nothing to install on Postgres. The worker packs
analytics events into segments, evaluates monitors, enforces retention and
reconciles workspaces; it starts once the API reports ready.

The command builds the checked-out source so all services use the same version.
The console forwards browser requests through its same-origin API proxy; its
upstream API and public console origins are runtime settings. Put HTTPS reverse
proxies in front of the public services and set the URLs in `.env` accordingly.
`DOCS_URL` controls the console's documentation links and the docs site's canonical
URLs and sitemap. Docs Explorer/claim links use `BASE_URL`; its request examples
and downloadable OpenAPI server use `API_URL`. These destinations are read at
runtime, so changing them requires restarting services, not rebuilding images.
The private `http://api:8080` upstream is never published in docs. The docs service
receives only public URLs, with no database connection or credentials.

## Bring your own Postgres

Point `DATABASE_URL` in `docker-compose.yml` at any Postgres 14 or later —
Neon, Supabase, RDS — and drop the `db` service. Nothing needs to be
installed on it. On a provider that hands out a pooled URL, also set
`COUNTED_DATABASE_DIRECT_URL` on `api` and `worker` to the direct host: reads
are faster there and the worker's `LISTEN` only works over a direct
connection (it falls back to a timer otherwise).

## Sign in

Open `BASE_URL`, choose Create account, and use email/password. Create a workspace.

Password sign-up and sign-in work without a mail provider. Configure both
`RESEND_API_KEY` and `COUNTED_MAIL_FROM` to enable sign-in links, recovery,
verification, and workspace invitations. Without mail, those actions are
unavailable; the application does not claim a message was sent.

Google and GitHub appear only when both values for that provider are configured.
Register the callback `${BASE_URL}/api/auth/callback/google` or
`${BASE_URL}/api/auth/callback/github` with the provider. Keep the auth secret
stable across restarts and identical on API and worker.

Billing is disabled in this Compose setup. Workspaces use the built-in Free
allowances; self-hosting does not implicitly grant Pro or change retention.
The Plan page explains when billing is unavailable. See the deployment guide
for optional Stripe configuration.

## Send your first event

Create a project in the console, issue an ingest key from setup, and choose the
HTTP or JavaScript example. Keep its one-time reveal. For a direct request:

```bash
COUNTED_VISIT_ID=$(openssl rand -hex 16)
curl -X POST "$API_URL/v1/events" \
  -H "Authorization: Bearer ck_your_key" \
  -H "Content-Type: application/json" \
  -d "{\"events\":[{\"name\":\"app_started\",\"visitId\":\"$COUNTED_VISIT_ID\",\"properties\":{}}]}"
```

A query on the project answers immediately; the worker packs the event into a
segment within seconds. Use an SDK for batching, retries, and ephemeral visits.
The project setup page confirms when an event is received. Create an Insight
from the observed events and properties.

## Upgrading

```bash
git pull --ff-only
docker compose up -d --build
```

The API migrates on boot under a lock. If a release changes the analytics
schema in a way the old data cannot follow, the release notes say so; there is
no automatic rewrite of packed segments.

## Backup and restore

Back up before upgrading, using the same PostgreSQL major version for the
dump/restore tools. The database includes authentication, dashboard definitions,
event data, and retry receipts; protect backups as private data.

```bash
umask 077
docker compose exec -T db pg_dump -U counted -d counted -Fc > counted.dump
docker compose exec -T db createdb -U counted counted_restore
docker compose exec -T db pg_restore -U counted -d counted_restore --exit-on-error < counted.dump
```

Restore into a separate database first. Verify tables, account access, Insights,
and ingestion before changing the service connection strings. Stop API and
worker writes during a final cutover, retain the previous database for rollback,
and test your provider's scheduled backups independently of this manual example.
Never restore over the active database as a rehearsal.
