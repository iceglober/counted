# Deploying Counted

Five services and one Postgres. The database is **plain Postgres 14 or
later with nothing installed** — Neon, Supabase, RDS, Railway's managed
Postgres, or the official image all work. The analytics engine (litics) keeps
its whole schema in plain SQL and plpgsql and runs its background work in the
worker process, so there is no extension to install and no server flag to set.
Readiness asserts the schema; the journey suite asserts that `pg_extension`
holds one row.

```
counted-api      apps/api      Bun + Hono      public   api.counted.dev     port 8080
counted-web      apps/web      Next.js         public   counted.dev + app.counted.dev  port 3000
counted-docs     apps/docs     Next.js         public   docs.counted.dev    port 3001
counted-worker   apps/worker   Bun             private  no ingress
counted-mcp      apps/mcp      Bun             public   mcp.counted.dev     port 8080
counted-db       Postgres 14+  plain           private
```

## Environment, per service

Each service receives only the settings it needs. A variable absent from a
service's column is a variable that service must not have — the web app having no
`DATABASE_URL` is the enforced part of "the console holds no privileged path".
Each service reads its environment once at boot and refuses to start with
every problem printed at once (`apps/api/src/config.ts`,
`apps/worker/src/config.ts`).

| variable | api | worker | web | notes |
|---|:--:|:--:|:--:|---|
| `DATABASE_URL` | ● | ● | | may be a pooled URL |
| `COUNTED_DATABASE_DIRECT_URL` | ○ | ○ | | the direct (non-pooled) host. Analytics reads are faster on it; the worker's compactor needs it for `LISTEN` (falls back to its timer without). Defaults to `DATABASE_URL` |
| `PORT` | ○ | | ○ | api 8080, web 3000 in the images |
| `COUNTED_API_URL` | ● | ● | ● | the API's public origin; the console proxies to it |
| `COUNTED_CONSOLE_URL` | ● | | ● | where the console lives; the CORS allowlist, and the origin every emailed sign-in link is re-hosted onto — the console proxies `/api/auth/*` and the cookie must land on the origin the reader is looking at |
| `COUNTED_SITE_URL` | | | ○ | public-site origin, defaults to `https://counted.dev`; only this Host serves the marketing homepage at `/`, while the console Host keeps its account redirect |
| `COUNTED_DOCS_URL`, `COUNTED_PUBLIC_API_URL` | | | ○ | public documentation and API destinations; defaults to `https://docs.counted.dev` and `https://api.counted.dev`, separate from the console's potentially internal API connection |
| `COUNTED_AUTH_SECRET` | ● | ● | | signs better-auth's cookies and tokens; the worker must hold the **same** one |
| `COUNTED_UNCLAIMED_WORKSPACE_ID` / `_OWNER_ID` | ● | ● | | the holding workspace anonymous projects are issued under; the API creates it if absent |
| `RESEND_API_KEY` + `COUNTED_MAIL_FROM` | ○ | ○ | | both or neither. api sends sign-in links; worker sends monitor mail |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL` | ○ | | | all four or none |
| `COUNTED_WEBHOOK_SIGNING_SECRET` | | ○ | | signs outbound monitor webhooks (Standard Webhooks) |
| `COUNTED_OUTBOX_SINK_URL` | | ○ | | where outbox envelopes are POSTed; no sink, no dispatch job |
| `COUNTED_TRUSTED_PROXY_HOPS` | ○ | | | how many proxies append to `X-Forwarded-For`; decides whether a country can be derived. 1 on Railway |
| `COUNTED_SEGMENT_CACHE_MB` | ○ | ○ | | decoded analytics segments kept per process; api 256, worker 64 |
| `COUNTED_QUERY_DEADLINE_MS` | ○ | | | 10000 |
| `COUNTED_PACK_INTERVAL_SECONDS`, `COUNTED_PACK_MAX_STAGING_AGE_SECONDS`, `COUNTED_PACK_LAG_WARN_SECONDS`, `COUNTED_SEGMENT_MAINTENANCE_INTERVAL_SECONDS` | | ○ | | the compactor: 10 / 60 / 300 / 3600 |
| `COUNTED_WORKER_CADENCE_SECONDS`, `COUNTED_MONITOR_*`, `COUNTED_OUTBOX_*`, `COUNTED_RETENTION_*`, `COUNTED_MAINTENANCE_INTERVAL_SECONDS`, `COUNTED_RECONCILE_*` | | ○ | | job cadences; defaults in `apps/worker/src/config.ts` |
| `LOG_LEVEL` | ○ | | | debug / info / warn / error |
| `RELEASE` | ○ | ○ | | the commit this build is. The deploy workflow sets it before each upload; both API health paths return it and the worker logs it. `RAILWAY_GIT_COMMIT_SHA` is read as a fallback |

● required ◐ build-time ○ optional

**The MCP server** (`counted-mcp`) holds no database URL and no secret of its own; it
forwards to the API with the caller's bearer. Its variables: `COUNTED_API_URL` (the API's
public origin), `COUNTED_MCP_RESOURCE` (its own public URL plus `/mcp`, e.g.
`https://mcp.counted.dev/mcp` — the OAuth resource identifier tokens are bound to; the API's
`COUNTED_MCP_URL` must be the same string), `COUNTED_OAUTH_ISSUER` (the API's auth mount,
`https://api.counted.dev/api/auth`), optional `COUNTED_MCP_DOCS_URL` and
`COUNTED_API_TIMEOUT_MS`, and `PORT` (8080 in the image). `/health/ready` is its health path.
Use the exact `issuer` returned by
`https://api.counted.dev/api/auth/.well-known/oauth-authorization-server`; the
API origin without `/api/auth` is a different issuer. Set `COUNTED_MCP_DOCS_URL`
to `https://docs.counted.dev` for the public reference.

**The documentation service** (`counted-docs`) accepts only public destinations:
`COUNTED_DOCS_URL`, `COUNTED_CONSOLE_URL` and `COUNTED_PUBLIC_API_URL`. They
default to the hosted docs, app and API origins and are read at request time,
so the same image works on self-hosted domains. It needs no database URL,
authentication secret or provider credential. Its image listens on port 3001;
set `PORT` when the platform requires another port.

**Neon.** Set `DATABASE_URL` to the pooled URL and `COUNTED_DATABASE_DIRECT_URL`
to the direct one on both api and worker. Nothing else: no `CREATE EXTENSION`,
no API call, no compute restart.

## Migrating an existing installation's configuration

The current services read the names in the table above. Legacy environment
names are not aliases; leaving them set does not configure the replacement.
Update variables without automatically redeploying each edit, then release the
API and worker together through the Deploy workflow.

| Legacy setting | Current setting | Placement |
|---|---|---|
| `EMAIL_FROM` | `COUNTED_MAIL_FROM` | API and worker, alongside `RESEND_API_KEY` |
| `APP_URL` | `COUNTED_CONSOLE_URL` | API and web; set `COUNTED_API_URL` separately to the API origin |
| `STRIPE_PRICE_MONTHLY_ID` | `STRIPE_PRICE_PRO_MONTHLY` | API; use the recurring monthly base price for the existing product |
| `STRIPE_PRICE_ANNUAL_ID` | `STRIPE_PRICE_PRO_ANNUAL` | API; use the recurring annual base price for the existing product |

API and worker must have the same production `COUNTED_AUTH_SECRET` and holding
workspace/account ids (`COUNTED_UNCLAIMED_WORKSPACE_ID` and
`COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID`). Preserve existing valid values and
holding ids; changing a signing secret invalidates sessions and tokens. The
web app receives only public destinations and its API connection URL, never the database URL,
auth signing secret, provider credentials or Stripe keys.

Preserve both the public-site and console domains on `counted-web`. Set its
`COUNTED_SITE_URL`, `COUNTED_DOCS_URL` and `COUNTED_PUBLIC_API_URL` to the public
origins when using different domains. See `apps/web/README.md` for public routes
and legacy documentation redirects.

Configure the complete Stripe group before enabling billing: both price ids,
`STRIPE_SECRET_KEY` and the signing secret for the webhook destination
`https://api.counted.dev/v1/webhooks/stripe`. Do not use a local
`STRIPE_API_BASE` override in production. Email flows require the complete
Resend pair on the API and monitor email requires it on the worker.
`GET /api/auth/capabilities` reports whether the API's email transport is
configured; successful delivery still requires a verified sender. Social
sign-in requires each enabled provider's `GITHUB_CLIENT_ID`/
`GITHUB_CLIENT_SECRET` or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pair on the
API. Provider callbacks use the console origin:
`https://app.counted.dev/api/auth/callback/github` or `/callback/google`.

Create both `counted-mcp` and `counted-docs` with their matching files under
`deploy/`, and attach their public domains before the next Deploy run. Neither
service needs a database URL or provider secret. Confirm the API's OAuth issuer
and MCP resource metadata agree, and confirm documentation serves `/openapi.json`.
The Deploy workflow requires these services and Smoke requires their public
endpoints; an unprovisioned service is an incomplete release configuration.

### Native Railway settings

[Railway configuration-as-code](https://docs.railway.com/config-as-code) is
deprecated. New services cannot opt in; existing services that already use it
remain supported only until December 1, 2026. Docs and MCP use native service
settings, with no configuration-file link. Their `deploy/docs.railway.json`
and `deploy/mcp.railway.json` files remain the checked-out release's expected
settings, read by Counted's release preflight rather than Railway.

Apply each file's `build.builder`, `build.dockerfilePath` and `deploy` fields
to the corresponding native service settings. For the manifest's `numReplicas`,
use an explicit native `deploy.multiRegionConfig` map in the chosen service
region, with counts totaling one. Railway's legacy flat replica field can be
null; the preflight requires either an authoritative numeric count or the
explicit regional map, and never assumes that null means one. Use the repository
root, the image CMD, and no build/start/pre-deploy command or watch-pattern override.
Docs listens on port 3001 and checks `/openapi.json`; MCP listens on port 8080
and checks `/health/ready`. Both use a 120-second health timeout, one replica,
and `ON_FAILURE` with three retries. Docs uses 20-second overlap and 10-second
draining; MCP uses 30 and 20 seconds respectively.

Stage and review configuration separately from deployment. An unapplied change
does not configure the next source upload. Before changing any `RELEASE`
variable or uploading source, Deploy verifies the token's project and environment
IDs, reads applied configuration with variable decryption disabled, and compares
docs/MCP settings against the exact checked-out release. Railway omits defaults
from the raw configuration; the preflight checks effective service-instance
values rather than assuming what an absent field means. Missing or mismatched
settings, a file link, conflicting overrides or an unreadable response stop the release. It
never writes configuration or commits other staged changes. For a rollback
whose expected settings differ, review and apply those settings first. The same
read runs immediately before each docs/MCP upload because API startup can take
minutes. Keep provider settings unchanged throughout deployment: the GitHub
deployment lock cannot prevent simultaneous edits in the Railway dashboard.

Existing API, worker and web services retain their previously enabled
configuration-file links for now. Move their settings to native configuration
and extend the release preflight before the December 1 deadline; creating a new
installation must use native settings for all five services.

## Monitor checks and delivery

Monitor evaluation and notification delivery require the worker. The console
distinguishes a monitor awaiting its first check, a failed/no-data check, a stale
reading, and a current reading. A check failure retains the previous value with
its original measurement time; it never substitutes zero.

Each breach or recovery commits recipient jobs atomically with the monitor
state. `monitor_deliveries` retries failed recipients with exponential backoff
from 30 seconds to one hour. Missing email or webhook configuration is a
delivery failure, visible in the monitor's detail, and stays queued until the
transport works. The general `COUNTED_OUTBOX_SINK_URL` is unrelated to these
recipient jobs and is not required for monitor notifications.

Webhook `webhook-id` and the email provider's idempotency key remain stable on
retries. Delivery is at least once: webhook receivers should deduplicate by id.
Recovery notices wait behind earlier notices to the same recipient. Changing
cooldown retains pending jobs; removing a recipient cancels its pending jobs.
Disabling, deleting, or retargeting a monitor cancels obsolete queued notices.
An already in-flight transport request may still complete.

`lastNotifiedAt` is the compatibility name for the time a breach notice was
queued. `lastDeliveredAt` records successful transport acceptance, not inbox
delivery or a person reading the message. Monitor detail also exposes pending
and failed delivery counts and the latest delivery error.

## Deploying

`.github/workflows/deploy.yml` is the only path to production. It runs when
the `CI` workflow succeeds on a push to `main` and deploys exactly the commit
CI tested — `workflow_run.head_sha`, not the branch head, which may have moved
by then. Every deployment, including a manual rollback, verifies a successful
push-to-main run of `ci.yml` for that exact SHA through GitHub's Actions API.
For each service it sets `RELEASE=<sha>` as a service variable
(`railway variable set … --skip-deploys`, so the variable change does not
start a redeploy of its own) and then uploads with `railway up --service
<name> --detach --json` from the repository root. The native docs/MCP settings
and the existing API/worker/web configuration files select the matching
Dockerfile under `deploy/`. The API goes first,
and the job waits for that deployment to reach `SUCCESS` before uploading the
worker, MCP server, console and documentation. All five services are required:
the workflow checks access to each before uploading and waits for the exact
deployment ID returned by each upload to reach `SUCCESS`. A newer or unrelated
deployment cannot satisfy that check. A failed, crashed, skipped or timed-out
deployment fails the workflow even when its detached upload succeeded.

`bun test tests/deploy` runs the workflow's actual shell with local GitHub and
Railway stubs, including mismatched CI commits and unrelated successful releases.
CI runs this check before permitting a release.

It needs three things in the repository's Actions settings: the secret
`RAILWAY_TOKEN` — a **project** token for the production environment
(Railway → project → Settings → Tokens), which scopes the CLI to that project
and environment — and the variables `RAILWAY_PROJECT_ID` and
`RAILWAY_ENVIRONMENT_ID`. Before uploading, the workflow verifies both token
IDs against those variables and requires the production environment. All CLI
commands use the project and environment supplied by the token. Nothing else
deploys: the services are not connected to GitHub in Railway, so a push does
not deploy on its own, and `railway up` from a laptop works but leaves no
record of what went out.

`GET /health` and `GET /health/ready` return `release`, so which build is
serving is `curl https://api.counted.dev/health`; the worker logs its release
in the `worker.starting` line.

## SDK publication

Application CI and deployment never publish npm packages. A successful main CI
run lets `.github/workflows/release-sdks.yml` prepare a Changesets version PR;
nonempty changesets must be versioned and merged before publishing. After the
versioned commit passes CI and reaches production, explicitly dispatch **Release
npm SDKs** on `main` with its full SHA. The release gate requires successful CI,
a successful Deploy artifact containing that resolved release and all five exact
service deployment IDs, clean npm tarballs, and live API readiness with the same
release. It then runs that commit's production smoke checks, including synthetic
ingest and query, immediately before publishing. Missing/expired/incomplete
artifacts, missing synthetic-project credentials or failed checks refuse the
release. The workflow shares the production deployment lock, and a registry
failure cannot fail CI or prevent the next application deploy. See [the Changesets
guide](../.changeset/README.md) for versioning and post-publication verification.

## Failure reporting

The `Deploy` Actions run records build and startup failures for every service.
After a successful run, `Smoke` checks the public API, console, marketing,
documentation and MCP endpoints. Smoke also runs every ten minutes and on demand.
The standalone workflow reads the live API's full commit SHA, verifies that it
belongs to `main`, and checks out that immutable revision. `SMOKE_EXPECTED_RELEASE`
must match API readiness before any synthetic write; release mode requires this
full SHA. A rollback therefore runs its own revision's probes, while a release
change between selection and readiness fails the run.

Release smoke requires repository secrets `SMOKE_CLIENT_KEY` (ingestion),
`SMOKE_SERVICE_KEY` (with `queries:run`) and `SMOKE_PROJECT_ID`, all for the same
dedicated synthetic project. Each run writes one `smoke_test` event with a fresh,
nonidentifying `smoke_run` property and requires a count of exactly one for that
marker. The committed event is read from the live tail without waiting for
compaction. Missing credentials fail before any checks run. For explicit
local checks, use `SMOKE_MODE=local bun scripts/smoke.ts` and override all five
`SMOKE_*_URL` destinations; unconfigured ingestion and query checks are then
reported as skipped. The served contract is checked at the docs site's
`/openapi.json`; the signed-out console is checked at `/` → `/sign-in`.

Enable GitHub Actions failure notifications for the account responsible for
production; delivery depends on that account's notification settings. See
[GitHub's workflow notification settings](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).

The former `/api/internal/railway-hook` bridge is retired. It is absent from the
current application and is not required by these workflows. Remove any Railway
webhook still pointing to that path and revoke its old shared token. No Counted
application email or customer monitor channel is involved in deploy reporting.
This reports workflow and periodic smoke failures; Railway's own project alerts
may additionally cover platform incidents and manual changes outside the workflow.

## Migrations

**Legacy database cutover.** Boot migrations support fresh databases and existing
v3 installations. Known v2 signatures — UUID IDs on workspaces, projects or
dashboards, or an embedded `dashboards.tiles` column — cause
`LegacySchemaNotSupported` under the schema lock, before any startup DDL.
This guard detects those legacy signatures; it is not a general schema drift
validator. No automatic v2-to-v3 data conversion is provided.

The v2-to-v3 cutover is a clean break: provision a **separate, empty database**
and start the new stack against it. Previous accounts, credentials, dashboards
and analytics data are not imported. Keep the old database and deployment
intact, with a current backup whose restoration has been verified, for recovery.
Verify the provision → ingest → query → dashboard journey on the new stack
before switching traffic. Keep the old and new services connected to their own
databases; do not reuse or clear the old database to make startup pass. Routine
rolling-deploy migrations apply within v3, not across this clean break.

The schema is applied **by the API at boot**, not by a pre-deploy step, under
one advisory lock so replicas rolling at once queue rather than race. Three
schemas, in order: the domain tables (`IF NOT EXISTS`, then any step in
`DOMAIN_MIGRATIONS` — the ledgered path by which a domain table that already
exists changes; see `packages/adapters/postgres/src/schema.ts`), better-auth's
tables (diffed against the live database), and litics' generated steps
(recorded by name in `public.schema_migrations`, since generated `CREATE
TABLE` statements are not idempotent). A redeploy against an unchanged schema
is a no-op. The worker applies the domain schema too (idempotent) and never
litics'. Every phase waits at most 30 s for the lock and then fails naming it
(`SchemaLockTimeout`), so a replica queued behind a wedged holder says so in
its log instead of hanging until the health check gives up.

**Why not a pre-deploy command.** Railway's one-off container is not on the
service network, so it could not resolve `*.railway.internal`, and migration
failed with `ENOTFOUND` on every deploy — the schema was actually being
applied by the app, silently, which nobody noticed for weeks. Running it in
the process that will serve traffic means it uses the same connection string
it is about to query with.

**A failed migration fails the deploy.** The API throws before the port is
bound, so the container never becomes healthy and Railway keeps the previous
one serving.

## Zero downtime

The API runs two replicas with `overlapSeconds: 30`, so the new deployment is
healthy before the old one is drained.

**Readiness is schema-aware.** `/health/ready` checks the domain tables and
then compares litics' expected columns against `information_schema`, and
answers `503` on drift. During a deploy that changes the analytics config, the
old replicas report not ready — which is correct: they were built against a
different schema and should not take traffic. Railway routes to the new ones.

**Draining.** Both Bun services handle `SIGTERM` — the API stops accepting,
finishes in-flight requests and closes its pools; the worker finishes the
current tick, lets the compactor finish its in-flight pack, and settles.
Neither runs under a shell, so the signal reaches PID 1.

**Ordering.** Deploy `api` first: it applies the schema, and `web` is a pure
client of it. The worker can go at any point — its jobs are leased and the
compactor's packs are per-tenant advisory-locked transactions, so one
interrupted mid-flight rolls back and is redone on the next tick. The deploy
workflow does exactly this: api, wait for its deployment to reach `SUCCESS`,
then worker, MCP server, web and docs.

**Rollback.** A rollback is a redeploy of an older commit: run the Deploy
workflow from the Actions tab (`workflow_dispatch`) with `sha` set to the
commit to go back to. It must already be on `main` and have a successful
push-to-main CI run for that exact SHA. Missing or inaccessible CI evidence
blocks the deployment. It goes through the same steps as a forward deploy,
`RELEASE` included, so
`curl https://api.counted.dev/health` confirms it landed. One limit stands: a
build whose analytics config expects a *different* schema reports not-ready,
because the database no longer matches it. That is deliberate — the
alternative is a replica quietly serving against a schema it was not built
for. In that case roll forward, or restore the database (below).

## The worker is where the analytics keep up

Reads are correct without the worker — the engine reads unpacked rows along
with packed segments — but they get slower as the staging table grows. The
worker's compactor packs staging into segments within seconds (on `NOTIFY`,
or its 10 s timer), merges small segments hourly, applies the 760-day
retention, and vacuums. Its maintenance check logs `PackLagging` when the
oldest staged row is older than `COUNTED_PACK_LAG_WARN_SECONDS`, and
`PackerUnwired` if a build somehow runs without one. Run exactly one worker,
or several — the per-tenant locks make a second replica skip what the first is
packing.

### Ingestion retry receipts

`public.ingest_receipts` stores a project-scoped digest of each SDK event key
and occurrence time, with no raw properties, visit IDs, or plaintext keys.
Receipts commit atomically with analytics writes and remain after packing and
event retention. Their table and unique index grow with distinct keyed events;
include that storage in database sizing and monitoring. Project deletion clears
its receipts. Do not purge them independently: doing so removes retry protection.
Receipts protect writes made after the idempotency migration; earlier events did
not retain their SDK keys and cannot be backfilled.

Admission checks quotas before checking durable receipts. A retry at a hard
quota limit can therefore be refused even if the event is already stored; it
never creates another stored copy or increments committed usage.

## Backups and the restore drill

The database is managed — Neon today, any Postgres provider tomorrow — and
the backups are the provider's. Counted keeps none of its own, so what needs
rehearsing is that the provider's copy actually boots the application. The
drill, whenever the schema phases change and at least every quarter:

1. Restore a backup into a fresh database. On Neon that is a branch from a
   point in time: `neon branches create --project-id <id> --name restore-drill`,
   then `neon connection-string restore-drill` for its URL.
2. Run the journey against it: `COUNTED_JOURNEY_DATABASE_URL=<that url>
   COUNTED_AUTH_SECRET=<production's> bun run journey`. The suite starts a
   local API on that URL, which applies all three schema phases at boot and
   must report ready, then takes one customer end to end. The secret has to
   be production's: `auth.jwks` in the restored data is encrypted with it,
   and any other one is a 500 on the first sign-in.
3. Delete the branch. The journey adds a customer of its own and nothing
   else, but the copy is disposable either way.

Last drill: not yet run — record the date here when it is.

## Building

Each service has a Dockerfile under `deploy/`. They copy the tree and then trim
the workspace to that service's dependency closure:

```
bun scripts/prune-workspace.ts apps/api && bun install
```

The closure is *computed* from the manifests, not listed — a per-service list
of workspaces is three lists that must agree with `workspaces` in
`package.json`, and the way they go stale is a new package breaking a deploy.
The analytics engine ships inside the image: `@litics/core` and
`@litics/compactor` are vendored under `vendor/` and are part of the closure.

> **Local build note.** Docker Desktop allocated under ~4 GiB may OOM-kill
> `bun install` (exit 137). Raise Docker → Settings → Resources → Memory to
> ~6 GiB to build locally. Railway's builders are not so constrained.

## Three things that bit during the first deploy

**A configuration file overrides native settings while legacy support lasts.**
For the existing API, worker and web services, the file selected under `deploy/`
overrides the dashboard. New docs/MCP services have no such link and use the
native settings checked by the release preflight above.

**Watch patterns filter `railway up`, not just git pushes.** A deploy from an
unchanged tree comes back `SKIPPED`, which in the dashboard reads like a deploy
that worked. They are off.

**`PORT` is Railway's, not the image's.** Next honoured the injected `8080`
while the generated domain targeted `3000`, which is a 502 with a perfectly
healthy container behind it. `PORT` is set explicitly on the web service.

## Custom domains

Each custom subdomain needs both a routing `CNAME` and a verification `TXT`.
A CNAME alone leaves setup pending. Obtain the current routing target from
`status.dnsRecords` and token from `status.verificationToken` through the
Railway dashboard or its public API. The token is **not dashboard-only**.
[Railway's domain API documentation](https://docs.railway.com/integrations/api/manage-domains)
describes both fields and the required DNS records.

For `docs.counted.dev`, configure the CNAME at `docs` and the verification TXT
at `_railway-verify.docs` in the `counted.dev` zone. Use the exact current value
Railway supplies, including the `railway-verify=` prefix. Repeat for each
custom host. After deleting and re-adding a domain, retrieve its new token;
do not reuse the previous verification record blindly.

This read-only query retrieves the configuration and readiness status:

```graphql
query DomainStatus($id: String!, $projectId: String!) {
  customDomain(id: $id, projectId: $projectId) {
    domain
    status {
      verificationToken
      dnsRecords { hostlabel requiredValue currentValue status }
      certificateStatus
    }
  }
}
```

Check DNS records are `VALID`, the certificate is `ISSUED`, and HTTPS responds
at the custom hostname. Testing a routing target alone does not verify the
custom hostname's routing or certificate.

## API documentation

Create a `counted-docs` Railway service with repository root `/` and the native
settings described above, with no configuration-file link. Its image builds the
oRPC OpenAPI document and serves Next's standalone output on port 3001. Use
`/openapi.json` for the health check.
No database or application secrets belong on this service. See the documentation
service's environment section above for its optional runtime destinations;
`PORT` and `HOSTNAME` default to 3001 and `0.0.0.0`.

Attach the custom domain `docs.counted.dev` to that service and add the DNS record
Railway provides before running the production Deploy workflow. Documentation
and MCP are required release services: a missing service, failed deployment or
unreachable public endpoint fails the deploy or smoke run. `COUNTED_DOCS_ENABLED`
is no longer used. Creating this configuration does not activate DNS or deploy.

For local development, `bun run docs:dev` serves the reference at port 3001, and
`bun run dev` starts it with the rest of Counted. Both the console and docs builds
regenerate `openapi.json`; the reference and API Explorer consume it through the
shared `@counted/openapi` workspace package.
