# Developing Counted

What a machine with nothing on it needs, in the order it needs it.

Everything below was run against a database created from scratch — `docker
compose down -v` then up — not recalled from a working tree that already had
the schema.

---

## Prerequisites

| | Version used | Why this one |
|---|---|---|
| [Bun](https://bun.sh) | 1.3.14 | The package manager and the runtime. Workspace packages point `main` at TypeScript source, so Node cannot run them directly. |
| Docker | 29.2.1 | The database. Colima or Docker Desktop both work; the compose file needs nothing exotic. |

`@litics/core` and `@litics/compactor` — the analytics engine — are vendored
under `vendor/` from the sibling `iceglober/litics` repository. Nothing is
needed from that checkout to build or run Counted; it is needed only to
*update* the copy, with `bun scripts/vendor-litics.ts` (which refuses a dirty
litics tree and records the commit in `VENDORED.json`).

### The database is stock Postgres

litics needs nothing installed: its schema is plain SQL and plpgsql, the
sketches that make unique counts merge across a workspace are `int8[]`
columns and a plain-SQL aggregate, and the background work is a process
(`apps/worker` runs it) rather than `pg_cron`. `docker-compose.yml` pulls
`postgres:17`; production can be Neon, Supabase, RDS or anything else that
speaks Postgres 14 or later. The journey suite asserts that `pg_extension`
holds one row, `plpgsql`.

`bun run dev` always talks to that local container, whatever `DATABASE_URL` in
`.env.local` says — a hosted URL left there for other work never becomes the one
your API migrates. The same holds for `bun run journey` and the live suites. To
run any of them against a hosted database on purpose, pass
`COUNTED_DEV_DATABASE_URL`, `COUNTED_JOURNEY_DATABASE_URL` or
`COUNTED_TEST_DATABASE_URL` for that run.

What that buys, concretely: a query is right the moment an event is written
(the engine reads the unpacked staging rows along with the packed segments),
and the worker's compactor packs staging into segments within seconds. If no
worker is running, reads stay correct and get slower as staging grows; the
worker's maintenance check reports `PackLagging` when that happens.

---

## Getting started

```sh
git clone …                     # this repo, with ../litics beside it
cd counted
cp .env.example .env.local      # then edit — see below
bun install
bun run dev                     # the whole product, one command
```

`bun run dev` starts every deployable, not a subset, because a subset behaves
differently from production in ways that are easy to mistake for a bug:

| what | where | why it has to be running |
|---|---|---|
| database | :5434 | stock `postgres:17`, from `docker-compose.yml` |
| Stripe stand-in | :8091 | `scripts/dev-stripe.ts` — see below |
| api | :8080 | the product's whole surface |
| worker | no port | packs segments, monitors, retention, outbox |
| mcp | :3002 | what an agent connects to |
| console | :3000 | proxies `/api/*` to the API |
| documentation | :3001 | OpenAPI reference and developer guide |

Order matters and the script enforces it: the database has to be *healthy*
rather than merely accepting connections before the API applies its schemas,
and the worker starts after the API because the API is what applies them.
Ctrl-C stops everything — by pid, then by port, then anything else still
parented to the script.

**Without the worker, events sit in staging forever.** Queries still answer,
because the read path unions the unpacked tail, so nothing looks broken —
but no segment is ever written and the storage the product is built on goes
unexercised. That is the single biggest way a partial stack misleads.

A first run takes about a minute, most of it pulling the Postgres image. The
API's own first boot is about five seconds — it applies three schemas — and
every boot after that is a no-op.

What you should see:

```
  env      .env.local
  database ready   postgres://counted:counted@localhost:5434/counted
  stripe stand-in  http://127.0.0.1:8091  (checkout pages, webhooks to http://localhost:8080)
  {"…","message":"identity schema applied","schema":"auth","created":16,"altered":0}
  {"…","message":"analytics schema applied","applied":8,"skipped":0}
  api ready        http://localhost:8080/health
  api readiness    {"status":"ready","service":"counted-api","detail":"schema is current"}
  worker started   packs segments, monitors, retention, outbox
  {"event":"compactor.scheduler.started","jobs":"pack,maintain","cadenceMs":1000}
  mcp ready        http://localhost:3002/mcp
  web starting     http://localhost:3000
```

On the second run the two schema lines read `created: 0` and
`applied: 0, skipped: 8`. That is the check that the boot path is idempotent,
and it is worth glancing at.

### What is real locally, and what is standing in

Everything the product does is real except the two services that belong to
somebody else.

**Stripe** is `scripts/dev-stripe.ts`. The API refuses to start with a
half-configured payment provider — a secret key and no webhook secret means
checkout works, the grant does not, and the customer has paid for nothing — so
"no Stripe locally" is not "billing is disabled", it is "the billing routes do
not exist and Upgrade 404s". The stand-in speaks Stripe's wire format at the
real paths, and it finishes the loop: the session's `url` is a checkout page it
renders itself, and paying on that page delivers a signed
`checkout.session.completed` to the API before returning the browser to the
console. Manage billing opens a portal page that can cancel. So the whole
upgrade — button, hosted page, webhook, entitlement — runs on a laptop with no
Stripe account. **A real test-mode `STRIPE_SECRET_KEY` in `.env.local` wins**:
the stand-in is skipped and the API talks to Stripe.

It is not Stripe. It never declines a card, never retries a delivery, never
sends the same event twice, and its prices are whatever the environment names.
Anything that turns on Stripe's own behaviour has to be proven against a
test-mode key.

**Email** requires both `RESEND_API_KEY` and `COUNTED_MAIL_FROM`. Without the
pair, the console hides email-dependent actions and the API refuses magic-link,
recovery, verification and invitation requests. Email/password signup and sign-in
still work. Magic links expire in five minutes. Identity tests capture delivery
locally without contacting a provider.

The **outbox** delivers to the stand-in too (`/outbox`), so the dispatch job
has somewhere to send monitor envelopes and its path runs rather than idling.
It logs each envelope's type and id, never its payload: `CredentialIssued`
carries the key it just minted.

**Social sign-in is the one thing that cannot be stood in for.** GitHub and
Google have to be real, because the callback is registered with the provider.
Leave `GITHUB_*` and `GOOGLE_*` unset and the console offers email/password,
plus magic links when email delivery is configured. Social callbacks return to
the console's `/api/auth/callback/github` or `/api/auth/callback/google` route.
The configured scopes are `read:user user:email` for GitHub and
`openid email profile` for Google. A new provider identity can link to an
existing same-email account only when both email addresses are verified.

Login uses necessary authentication cookies, including temporary cookies during
the sign-in flow. The login cookie normally lasts 30 days and an active session
refreshes at most daily. Session writes omit IP addresses and user-agent strings;
identity migration also clears these fields and obsolete auth rate-limit rows
from earlier v3 installations while preserving accounts and session tokens.
Authentication rate limits remain enabled, with expiring counters held only in
each API process's memory. They reset on restart and are not shared across
replicas; size any deployment-wide edge limits accordingly. Auth cookies and
account records are separate from SDK visits and customer analytics.

There are no events until you send some:

```sh
bun scripts/seed-events.ts --api http://localhost:8080     # provisions a project and fills it
```

To enrich an existing local dashboard with compact numbers, multiple event series,
OS/locale breakdowns, and a conversion funnel, supply a workspace service key in
`COUNTED_SEED_KEY` and run:

```sh
bun scripts/seed-dashboard.ts --workspace WORKSPACE_ID --project PROJECT_ID --dashboard DASHBOARD_ID
```

The script uses the public API, validates each analysis, retains existing Insights,
and saves a varied grid layout. It sends synthetic events on first setup; later
runs update the named examples without adding events. Pass `--events` to explicitly
add another batch. `--api` overrides the local API origin. Email/password sign-in
is also supported via `COUNTED_SEED_EMAIL` and `COUNTED_SEED_PASSWORD`.

### Running the pieces separately

```sh
docker compose up -d db                              # just the database
PORT=8080 bun run --cwd apps/api dev                 # just the API (needs the env below)
bun run --cwd apps/web dev                           # just the console
bun run docs:dev                                     # just the API reference
DATABASE_URL=… bun run --cwd apps/worker dev         # monitors, outbox, retention, maintenance
bun run --cwd apps/mcp dev                           # MCP tools over the same contract
bun scripts/dev-stripe.ts                            # the Stripe stand-in on its own
```

**Do not point the console at production to skip running the API.** The API's
CORS policy allows the console origin only, so the browser is refused at the
preflight and the page looks broken for a reason that has nothing to do with
the page.

---

## Environment

`.env.local` is gitignored, wins over everything, and is loaded twice — once by
`scripts/dev.sh` and again by Bun itself for anything run from the repository
root. That second load is worth knowing about: **a stale variable name in
`.env.local` stops the API even when your shell environment is correct.** The v2
names (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_FROM`, `APP_URL`) are
all gone.

`apps/api` and `apps/worker` read their environment **once, at startup**, and
refuse to start with every problem printed at once. A deployment with a hole in
it fails before it takes traffic, rather than on the first request that reaches
the hole.

### `apps/api` — required

| Variable | What it is |
|---|---|
| `DATABASE_URL` | `postgres://counted:counted@localhost:5434/counted` locally. Port 5434, not 5432, so it never collides with a Postgres you already run. |
| `COUNTED_API_URL` | The origin this API answers on. It is the authorization server's published identity — the issuer an MCP access token carries — and OAuth callbacks are registered against it. No trailing slash. |
| `COUNTED_CONSOLE_URL` | Where the console lives. Checkout and the billing portal return here, and **every link we email is re-hosted onto it**: the console proxies `/api/auth/*`, and a session cookie belongs to whichever origin the browser received it from, so a link clicked on the API's origin signs the reader in there and leaves the console signed out. Locally the two differ only by port and cookies ignore ports, which is why a wrong value survives development and fails in production. |
| `COUNTED_AUTH_SECRET` | Signs better-auth's cookies and tokens. **There is no default and there must not be one** — a shipped default is a shipped session-forgery key. `openssl rand -hex 32`. |
| `COUNTED_UNCLAIMED_WORKSPACE_ID` | See "the one bootstrap order that matters" below. |
| `COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID` | Same. |

### `apps/api` — optional

`PORT` (3001 in code, 8080 from `scripts/dev.sh`, which is what actually starts
it) · `LOG_LEVEL` (`debug|info|warn|error`, default `info`) ·
`COUNTED_SERVICE_NAME` · `COUNTED_CLAIM_GRANT_HOURS` (72) ·
`COUNTED_SHARE_LINK_DAYS` (30) · `COUNTED_QUERY_DEADLINE_MS` (10000) ·
`COUNTED_WEBHOOK_SIGNING_SECRET` · `COUNTED_TRUSTED_PROXY_HOPS` (1).

`COUNTED_TRUSTED_PROXY_HOPS` is the only one of those with a security
consequence. `country` is derived from the request address, read that many
entries back from the **end** of `X-Forwarded-For` — each proxy appends the
address it received the connection from, so counting from the right ignores a
value the caller invented. One is the deployed topology (the platform edge); a
CDN in front makes it two; `0` derives no country at all, which is the right
answer where nothing in front is trusted to set the header.

Locally there is no proxy, so nothing sets the header and no country is derived.
`bun run seed` sends one itself — that is the only way to get a country
breakdown on a development database, because the address is discarded and there
is no property a client can set instead.

Two groups are **all-or-nothing** and refused half-configured:

- `RESEND_API_KEY` + `COUNTED_MAIL_FROM`. Left off entirely, sign-in links
  print to the API log, which is what you want locally.
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_PRO_MONTHLY` +
  `STRIPE_PRICE_PRO_ANNUAL`. A secret key with no webhook secret is worse than
  Stripe absent: checkout works, the webhook that grants the plan does not, and
  the customer has paid for nothing.

### `apps/web`

`COUNTED_API_URL` and `COUNTED_CONSOLE_URL` — the same two names the API uses,
and deliberately so: the console is a forwarding proxy, so its API base and the
API's idea of its own origin have to be one string. Both have working localhost
defaults, and **neither is a secret**. That is an invariant, not a coincidence:
`no-credentials.test.ts` reads `apps/web` and fails if a credential-shaped
variable appears in it. A service key here would make "every console action is
reachable by a third party with the right key" false.

### `apps/worker`

`DATABASE_URL` required. Everything else has a default: `COUNTED_*_INTERVAL_SECONDS`,
`COUNTED_*_BATCH`, `COUNTED_WORKER_CADENCE_SECONDS`, `COUNTED_RECONCILE_REPAIR`.
Notifications share the API's names — `RESEND_API_KEY`, `COUNTED_MAIL_FROM`,
`COUNTED_WEBHOOK_SIGNING_SECRET`, plus `COUNTED_OUTBOX_SINK_URL`.

A third all-or-nothing group turns on the **provisioning reconciler**:
`COUNTED_AUTH_SECRET`, `COUNTED_API_URL`, `COUNTED_UNCLAIMED_WORKSPACE_ID`,
`COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID` — the same four the API reads, and the
secret must be *the same value*, because better-auth's `jwks` private key is
encrypted with whichever secret wrote it. When the secret changes after the key
exists — a journey run against the development database with a different
`COUNTED_AUTH_SECRET`, say — every authenticated request fails as a bare 500
from `/v1/me` ("Failed to decrypt private key"); the fix is
`docker compose exec db psql -U counted -c 'delete from auth.jwks'`, and the
next boot writes a key under the current secret. Without them the job runs and reports
`available: false`, naming what is missing; it does not scan a database it
cannot see and call every project healthy.

What it repairs: creating a project is a project row of ours plus an ingest key
of better-auth's, on two connections with no transaction across them. A crash
between the two leaves a project that can never receive an event — in the
console, holding a slot against the plan's cap, with nothing in the product
ever erroring about it. The job finds those and issues the missing key through
the same use case provisioning uses, attributed to the workspace's most senior
member. It issues and never deletes: the same crash can also happen after the
key exists, and a repair acting on that evidence would destroy a project whose
key the customer is already using. `COUNTED_RECONCILE_REPAIR=false` (the
default) finds and reports without writing.

### `apps/mcp`

`COUNTED_API_URL`, `COUNTED_MCP_RESOURCE` (this server's public URL, which is
also its OAuth resource identifier), `COUNTED_OAUTH_ISSUER` (the API's
better-auth origin, `${COUNTED_API_URL}/api/auth`). Optional: `PORT` (8788),
`COUNTED_API_TIMEOUT_MS` (30000), `COUNTED_MCP_DOCS_URL`.

### The holding workspace

`COUNTED_UNCLAIMED_WORKSPACE_ID` and `COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID` name
the workspace an anonymously-provisioned project's ingest key is issued against
and the account recorded as having issued it. **The API creates both at boot**
if they are not there, under the same advisory lock as the schema steps, so
there is no bootstrap order and no seeding — `POST /v1/projects/provision`
works on a database created seconds ago. Look for `holding workspace ready` in
the boot log; `created` names which of the three rows it had to write, and
`nothing` on every boot after the first.

An unclaimed project has to have its key issued *somewhere*: a key's permission
set is derived from the issuing account's role, a role only exists inside a
workspace, and a workspace-less credential would need a second derivation rule
beside the one grant table. So an unclaimed project is born into the holding
workspace, and identity refuses a key for an unclaimed project issued against
any other one. Claiming moves the project's keys into the workspace that now
owns them (`CredentialStore.reassignProject`), so the customer's own ingest key
appears in their credential listing rather than in the installation's.

Two properties worth knowing before pointing the variables somewhere else:

- **An existing row is never modified.** Aim them at your own workspace and
  account and nothing is written. In particular a `member`-role standing is not
  promoted to `owner` behind your back — it is reported at boot as
  `holding workspace cannot issue`, because `events:write` is admin-and-up and
  anonymous provisioning would otherwise fail with `NothingGrantable`.
- **The account it creates cannot sign in.** `unclaimed@counted.invalid`,
  unverified, with no `account` row behind it — no password and no social
  identity. It exists so that every anonymously issued key is attributable to
  something an audit can read, rather than to the empty string v1 wrote.

---

## What the API does at boot

Three schemas, in this order, all on the same advisory lock so replicas rolling
at once queue rather than race.

1. **`applySchema`** (`packages/adapters/postgres/src/schema.ts`) — the domain's
   tables in `public`, plus the `auth` **namespace**. Every statement is
   `IF NOT EXISTS`, so replaying it re-derives the same schema.
2. **`migrateIdentity`** (`packages/identity/adapter-better-auth/src/migrate.ts`)
   — better-auth's sixteen tables, from better-auth's own `getMigrations`. It
   diffs the live database, so a second run creates nothing.
3. **`applyMigrations`** (`packages/adapters/postgres/src/migrations.ts`) with
   litics' three steps — the dictionary and the KMV aggregate, the staging
   table, and the segments and summary tables — plus, because tenancy has a
   hierarchy, the closure table, its triggers and the RLS policies. Generated
   migrations are **not** idempotent (`CREATE TABLE analytics.dims (…)`, no
   `IF NOT EXISTS`), so applied step names are recorded in
   `public.schema_migrations` and a boot that finds them all does nothing.

Three things about that are easy to get wrong and are worth knowing:

- **`auth` must exist before step 2.** better-auth 1.7 creates its tables
  unqualified and reads the target schema back from `SHOW search_path`; it never
  creates a schema. Point it at a missing one and it logs
  `Schema 'auth' does not exist`, writes into `public` instead, finds them there
  forever after, and works — while the one query that reads `auth.member` by its
  qualified name returns no rows for everybody. `main.ts` checks the schema it
  actually wrote to and refuses to start if it is not `auth`.
- **`apps/api` opens two pools onto one database.** The second exists only to
  carry `options: -c search_path=auth,public` for better-auth. That setting
  cannot go on the domain's pool, because `applySchema` also creates its tables
  unqualified and they would follow it into `auth`.
- **litics' schema is `analytics`, not `events`.** `events` is litics' package
  default; `packages/analytics/adapter-litics/src/config.ts` configures
  `analytics`. litics generates `CREATE SCHEMA IF NOT EXISTS analytics` itself,
  so nothing here creates it.

### Health

Two paths, two different questions, and both exist so a deploy can distinguish
them:

- **`GET /health`** — liveness. Answers from memory, touches nothing. A liveness
  check that queried the database would turn a slow query into a rolling
  restart.
- **`GET /health/ready`** — readiness. Reaches the database, checks every domain
  table is present, and checks the analytics schema still matches the config the
  query builders were generated from. 503 with a `detail` saying why when it is
  not ready.

`deploy/api.railway.json` points at `/health/ready`, which is the right one for
a platform deciding whether to route traffic. **This settles the v2
inconsistency**, where the deployed API answered `/health` while the Railway
check pointed at `/v1/health` and 404'd — so every deploy waited out the check's
timeout and then went healthy anyway, and a genuinely broken instance looked
exactly like a working one. There is no `/v1/health`; the paths are `/health`
and `/health/ready`, and `server.test.ts` asserts both answer.

---

## Checks

```sh
bun run typecheck     # tsc --noEmit over the whole workspace, tests included
bun run arch          # dependency-cruiser: the eight rules
bun test              # unit suites, plus live-Postgres suites when the db is up
bun run openapi:check # the committed document still matches the contract
bun run journey       # the end-to-end journey — a real API, a real database
```

The database-backed suites **skip rather than fail** when Postgres is not
running, so `bun test` gives a useful answer without Docker. They create their
own databases (`counted_adapter_test`, `counted_migrations_test`) so a run
cannot truncate your development data.

### The journey

`tests/journey/` is one customer, start to finish: sign up, own a workspace,
make a project, send an event, ask a question, build a dashboard, share it,
fail to escalate, and pay. It is **not** part of `bun test`, because it is a
different kind of proof — it starts `apps/api/src/main.ts` the way a deployment
does, on a port of its own, talks to it over HTTP, and checks the results
against Postgres on a second connection. No fakes.

That matters because `bun test` cannot see the defects it catches. Every unit
suite here runs over in-memory doubles, and four defects survived 2,000 of
them, a clean `tsc` and a clean `arch`: project creation failed 100% of the
time against a real store, nothing ever wrote the analytics tenancy row so
every query answered zero, the billing namespace was declared and never
mounted, and no dashboard readout had met a real cube.

It needs `docker compose up -d db` and nothing else. It runs against the
development database, and every identifier it mints carries a per-run suffix,
so repeated runs share a database and collide with nothing. It is equally
happy on a database created seconds earlier. It packs segments itself where a
test wants to prove the packed path (`flushSegments`), so no worker has to be
running.

The one thing it stubs is the payment provider: there is no Stripe test key
here, and a checkout route that can only be exercised by taking somebody's
money is a route nobody exercises. `STRIPE_API_BASE` points the Stripe SDK at
a local stub — the same hook `stripe-mock` uses — so everything up to the wire
is real, including the request Stripe would have received. `.github/workflows/journey.yml`
runs it in CI against the official `postgres:17` image.

---

## Browser journeys

The console regression suite uses Chromium at desktop and phone sizes. It checks
sign-in continuation, project creation and installation, Insight filters surviving
edits and reloads, saved dashboard layouts, invitation account handoff and
acceptance, share-link revocation, and plan controls for owners and members.

```sh
bunx playwright install chromium
bun run --cwd apps/web build
COUNTED_BROWSER_DATABASE_URL=postgres://counted:counted@127.0.0.1:5434/counted bun run test:browser
```

The database user needs `CREATE DATABASE`. The runner requires a local PostgreSQL
server, creates a unique database, and drops only that database on exit. It starts
the API, console, and a Stripe stand-in on ports 8891, 3300, and 12112. Email and
social providers are disabled; no production credentials are inherited. CI runs
the same suite and retains failure screenshots and traces for seven days.

To keep an existing development console running during the build and test, set
`COUNTED_NEXT_DIST_DIR=.next-browser` on both commands. The suite never connects to
an existing browser or application server.

## Resetting

```sh
docker compose down -v && docker compose up -d db
```

The volume is `counted_pgdata-17`. Older ones may still be on disk —
`counted_pgdata`, `counted_pgdata-stock` and `counted_pgdata-litics`, the last
initialised by the extension image this repository used to build. A data
directory from a different major version or image makes Postgres refuse to
start with a version-mismatch error that reads like corruption. Nothing in any
of them is worth keeping; `docker volume rm counted_pgdata counted_pgdata-stock
counted_pgdata-litics` reclaims the disk.
