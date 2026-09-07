#!/usr/bin/env bash
#
# The whole product, one command.
#
#   bun run dev          # from the repo root
#
# Counted is five deployables and a database, and this starts all of them:
#
#   database   docker, :5434          stock postgres:17
#   api        apps/api, :8080        the product's whole surface
#   worker     apps/worker            packs segments, runs monitors, retention
#   mcp        apps/mcp, :3002        what an agent connects to
#   console    apps/web, :3000        proxies /api/* to the API
#   docs       apps/docs, :3001       generated API reference
#
# plus a stand-in for the one external service the product cannot work without
# (scripts/dev-stripe.ts, :8091 — Stripe's checkout and the outbox's receiver).
#
# Start only the console and every button that talks to the API fails with
# ERR_CONNECTION_REFUSED, which reads like a bug in the page rather than a
# missing process. Start only the API and the console, and events sit in
# staging forever because nothing packs them — queries still answer, since the
# read path unions the staging tail, but nothing behaves the way production
# does.
#
# Pointing the console at production instead does NOT work, and it is worth
# knowing why before trying: the API's CORS policy allows the console origin
# only, so a browser call from localhost is refused at the preflight. The API
# has to be local.
#
# Ctrl-C stops everything.

set -euo pipefail
cd "$(dirname "$0")/.."

# .env.local is never committed and wins for everything but the database. Bun
# loads it too, for anything run from the repository root — which is why a
# stale variable name in it stops the API even when this script's own defaults
# are right.
# What the caller asked for, kept across the sourcing below.
#
# `.env.local` wins for everything — that is the documented rule and it is the
# right one — except the ports and the two URLs derived from them. The file
# cannot know which ports *this* run was told to use, so `API_PORT=8180 bun run
# dev` would otherwise start the API on 8180 and leave the console proxying to
# the 8080 in the file: every request a 503, and nothing saying why.
_want_api_port="${API_PORT:-}"
_want_web_port="${WEB_PORT:-}"
_want_docs_port="${DOCS_PORT:-}"
_want_mcp_port="${MCP_PORT:-}"
_want_stripe_port="${STRIPE_PORT:-}"
_want_api_url="${COUNTED_API_URL:-}"
_want_console_url="${COUNTED_CONSOLE_URL:-}"

if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
  echo "  env      .env.local"
fi

[ -n "$_want_api_port" ] && API_PORT="$_want_api_port"
[ -n "$_want_web_port" ] && WEB_PORT="$_want_web_port"
[ -n "$_want_docs_port" ] && DOCS_PORT="$_want_docs_port"
[ -n "$_want_mcp_port" ] && MCP_PORT="$_want_mcp_port"
[ -n "$_want_stripe_port" ] && STRIPE_PORT="$_want_stripe_port"
[ -n "$_want_api_url" ] && COUNTED_API_URL="$_want_api_url"
[ -n "$_want_console_url" ] && COUNTED_CONSOLE_URL="$_want_console_url"

# A port override with no matching URL is the trap above: derive the URL rather
# than let the file's value point at a port nothing is listening on.
if [ -n "$_want_api_port" ] && [ -z "$_want_api_url" ]; then
  COUNTED_API_URL="http://localhost:${API_PORT}"
fi
if [ -n "$_want_web_port" ] && [ -z "$_want_console_url" ]; then
  COUNTED_CONSOLE_URL="http://localhost:${WEB_PORT}"
fi

: "${API_PORT:=8080}"
: "${WEB_PORT:=3000}"
: "${DOCS_PORT:=3001}"
: "${MCP_PORT:=3002}"
: "${STRIPE_PORT:=8091}"
# Development means the local database, whatever DATABASE_URL says in the
# environment or in .env.local: a hosted URL left there from other work must
# not become the one the API you are hacking on migrates. To run against a
# hosted database on purpose, say so with COUNTED_DEV_DATABASE_URL.
DATABASE_URL="${COUNTED_DEV_DATABASE_URL:-postgres://counted:counted@localhost:5434/counted}"
: "${COUNTED_API_URL:=http://localhost:${API_PORT}}"
: "${COUNTED_CONSOLE_URL:=http://localhost:${WEB_PORT}}"
# Development only, and deliberately not a secret: it signs cookies for a
# database that lives in a throwaway volume. `apps/api` refuses to start
# without one rather than inventing a default of its own, which is the right
# behaviour in production and would only be an obstacle here.
: "${COUNTED_AUTH_SECRET:=dev-secret-not-for-production-0123456789abcdef}"
# Where an anonymously-provisioned project's ingest key is issued. The API
# creates the workspace, its owner membership and the account at boot when they
# are missing, so a fresh volume needs no seeding. See DEVELOPING.md.
: "${COUNTED_UNCLAIMED_WORKSPACE_ID:=ws_holding}"
: "${COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID:=acct_operator}"

# The MCP server's public URL is also its OAuth resource identifier, and the
# API has to be told the same string — a token is bound to the resource that
# asked for it, so two spellings mean every agent request is refused.
: "${COUNTED_MCP_RESOURCE:=http://localhost:${MCP_PORT}/mcp}"
: "${COUNTED_MCP_URL:=${COUNTED_MCP_RESOURCE}}"
: "${COUNTED_OAUTH_ISSUER:=${COUNTED_API_URL}/api/auth}"

# The stand-in receives the worker's monitor webhooks as well as playing
# Stripe, so the outbox job has somewhere to deliver and its path is exercised
# rather than skipped. Both names or neither: the worker refuses an unsigned
# webhook rather than sending one its receiver cannot trust.
: "${COUNTED_OUTBOX_SINK_URL:=http://127.0.0.1:${STRIPE_PORT}/outbox}"
: "${COUNTED_WEBHOOK_SIGNING_SECRET:=dev-outbound-webhook-secret}"

# Billing is all four names or none — the API refuses a half-configured
# provider, because checkout that works with a grant that does not means a
# customer has paid for nothing. With no real key present these point at the
# stand-in, which serves the checkout page too, so the upgrade path runs
# locally end to end. A real test-mode key in .env.local wins and is left
# talking to Stripe.
STRIPE_STANDIN=""
if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  STRIPE_STANDIN=yes
  STRIPE_SECRET_KEY="sk_test_dev_stand_in"
  STRIPE_WEBHOOK_SECRET="whsec_dev_stand_in"
  STRIPE_PRICE_PRO_MONTHLY="price_dev_monthly"
  STRIPE_PRICE_PRO_ANNUAL="price_dev_annual"
  STRIPE_API_BASE="http://127.0.0.1:${STRIPE_PORT}"
fi

export DATABASE_URL COUNTED_API_URL COUNTED_CONSOLE_URL COUNTED_AUTH_SECRET
export COUNTED_UNCLAIMED_WORKSPACE_ID COUNTED_UNCLAIMED_WORKSPACE_OWNER_ID
export COUNTED_MCP_RESOURCE COUNTED_MCP_URL COUNTED_OAUTH_ISSUER
export COUNTED_OUTBOX_SINK_URL COUNTED_WEBHOOK_SIGNING_SECRET
export STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_PRO_MONTHLY STRIPE_PRICE_PRO_ANNUAL
[ -n "$STRIPE_STANDIN" ] && export STRIPE_API_BASE

# --- the database ------------------------------------------------------------
if [ -z "${COUNTED_DEV_DATABASE_URL:-}" ]; then
if ! docker compose up -d db >/dev/null 2>&1; then
  echo "  !! could not start the database."
  echo "     Is the container runtime up?  colima start   (or open Docker Desktop)"
  exit 1
fi

# Wait for the compose healthcheck (`pg_isready`), so the API's first
# migration never races a server that is still initialising its data
# directory on first boot.
echo "  database starting…"
for _ in $(seq 1 90); do
  state="$(docker inspect --format '{{.State.Health.Status}}' counted-db-1 2>/dev/null || echo missing)"
  [ "$state" = "healthy" ] && break
  sleep 2
done
if [ "${state:-}" != "healthy" ]; then
  echo "  !! the database never became healthy (last state: ${state:-unknown})."
  echo "     docker compose logs db"
  exit 1
fi
echo "  database ready   local compose"
else
  echo "  database         using COUNTED_DEV_DATABASE_URL"
  bun -e 'import { Pool } from "pg"; const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 }); try { await pool.query("SELECT 1"); } catch { console.error("The configured development database is unreachable."); process.exitCode = 1; } finally { await pool.end(); }' || exit 1
fi

# --- ports -------------------------------------------------------------------
# Refuse a port somebody else already holds, before starting anything.
#
# This is not tidiness. The readiness loop below polls `/health`, and a stale
# API from an earlier session answers it — so without this check the script
# prints "api ready", starts the console, and the console talks to a process
# pointed at a database that may no longer exist. The API this run started died
# on `Failed to start server. Is port 8080 in use?` and the message scrolled
# past under the console's output.
PORTS="${API_PORT} ${WEB_PORT} ${DOCS_PORT} ${MCP_PORT}"
[ -n "$STRIPE_STANDIN" ] && PORTS="${PORTS} ${STRIPE_PORT}"

# `-sTCP:LISTEN` is not optional. Without it `lsof -ti tcp:3000` reports every
# process holding *any* socket on that port number — including a browser's
# outbound connection to someone else's :3000 — and this script then refuses to
# start, or worse, kills it. That is not hypothetical: it SIGKILLed a browser
# whose only crime was an established connection to a remote host's :8080.
busy=""
for port in $PORTS; do
  if lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then busy="${busy} ${port}"; fi
done
if [ -n "$busy" ]; then
  echo "  !! port(s)${busy} already in use — most likely an earlier run of this script."
  for port in $busy; do echo "     kill \$(lsof -ti tcp:${port})"; done
  exit 1
fi

# Everything this script started dies with it, including on Ctrl-C — by pid
# first, then by port, then anything else still parented to this script. The
# passes after the first are not paranoia: Next's dev server runs the actual
# listener in a child process that outlives a SIGINT to its parent, and the
# port it keeps is what makes the next run refuse to start. The worker holds no
# port at all, so only its pid can find it.
PIDS=""
cleanup() {
  trap - EXIT INT TERM
  for pid in $PIDS; do kill "$pid" 2>/dev/null || true; done
  sleep 1
  # Listeners only — see the note above the busy check. A client with a
  # connection to one of these ports is somebody else's process.
  for port in $PORTS; do
    lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
  sleep 1
  for port in $PORTS; do
    lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
  pkill -P $$ 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for a URL to answer, giving up the moment the process behind it is gone.
# A config problem exits immediately, and sixty seconds of silence after an
# error message that has already scrolled past is how "it refused to start"
# gets read as "the script hung".
await() {
  name="$1"; pid="$2"; probe="$3"; tries="${4:-120}"
  for _ in $(seq 1 "$tries"); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    if curl -fsS "$probe" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "  !! ${name} did not come up — see the log above."
  return 1
}

# --- the stand-in ------------------------------------------------------------
if [ -n "$STRIPE_STANDIN" ]; then
  # Watched like every other process here. Its sessions live in memory, so an
  # edit forgets any checkout already open — start that one again.
  COUNTED_DEV_STRIPE_PORT="$STRIPE_PORT" bun --watch scripts/dev-stripe.ts &
  STRIPE_PID=$!
  PIDS="$PIDS $STRIPE_PID"
  await "the stripe stand-in" "$STRIPE_PID" "http://127.0.0.1:${STRIPE_PORT}/health" 40 || exit 1
fi

# --- the API -----------------------------------------------------------------
PORT="$API_PORT" bun run --cwd apps/api dev &
API_PID=$!
PIDS="$PIDS $API_PID"

# Generous: the first boot applies three schemas — the domain's, better-auth's
# seventeen tables, and litics' three steps. Sixty seconds is comfortable; it
# takes about five.
if ! await "the api" "$API_PID" "http://localhost:${API_PORT}/health"; then
  echo "     Most often a missing or misnamed environment variable: the API prints"
  echo "     every problem at once and exits. Otherwise the schema failed to"
  echo "     apply, and the error names the migration step and the statement."
  exit 1
fi
echo "  api ready        http://localhost:${API_PORT}/health"

# Readiness is the deeper question — can it reach the database, and is the
# analytics schema the one this build's query builders were written against.
# Printed rather than waited on: a not-ready API still serves /health, and the
# detail says what is wrong.
ready="$(curl -fsS "http://localhost:${API_PORT}/health/ready" 2>/dev/null || echo '{"detail":"not ready"}')"
echo "  api readiness    ${ready}"

# --- the worker --------------------------------------------------------------
# Started after the API because the API is what applies the schema; a worker
# that wins that race spends its first cadence logging tables that do not exist
# yet. It holds no port, so there is nothing to wait on — it says what it runs
# on its first tick.
bun run --cwd apps/worker dev &
WORKER_PID=$!
PIDS="$PIDS $WORKER_PID"
echo "  worker started   packs segments, monitors, retention, outbox"

# --- the MCP server ----------------------------------------------------------
PORT="$MCP_PORT" bun run --cwd apps/mcp dev &
MCP_PID=$!
PIDS="$PIDS $MCP_PID"
if await "the mcp server" "$MCP_PID" "http://localhost:${MCP_PORT}/health/ready" 60; then
  echo "  mcp ready        ${COUNTED_MCP_RESOURCE}"
else
  echo "     (the console and API are unaffected; agents cannot connect.)"
fi

# --- the documentation -------------------------------------------------------
bun scripts/generate-openapi.ts
bun run --cwd apps/docs dev -- --port "${DOCS_PORT}" &
DOCS_PID=$!
PIDS="$PIDS $DOCS_PID"
echo "  docs starting    http://localhost:${DOCS_PORT}"

# --- the console -------------------------------------------------------------
echo "  web starting     ${COUNTED_CONSOLE_URL}"
if [ -n "$STRIPE_STANDIN" ]; then
  echo
  echo "  Billing runs against a stand-in on :${STRIPE_PORT} — Upgrade opens a local"
  echo "  checkout page, and paying on it delivers the webhook that grants the plan."
  echo "  No events yet?  bun scripts/seed-events.ts --api http://localhost:${API_PORT}"
fi
if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${COUNTED_MAIL_FROM:-}" ]; then
  echo "  Email delivery is unavailable. Use password sign-up/sign-in; email actions"
  echo "  become available when RESEND_API_KEY and COUNTED_MAIL_FROM are configured."
fi
echo
# Not exec'd: the script stays the parent of every process so that its cleanup,
# not the shell's process-group signal, decides what stops.
bun run --cwd apps/web dev -- --port "${WEB_PORT}" &
WEB_PID=$!
PIDS="$PIDS $WEB_PID"
wait "$WEB_PID"
