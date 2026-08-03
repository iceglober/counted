#!/usr/bin/env bash
#
# The whole stack, one command.
#
# Counted is three processes in development — a database, an API on :8080 and
# the web app on :3000 — and the web app's default API base is `localhost:8080`
# precisely because that is where `apps/api` binds. Start only the web app and
# every button that talks to the API fails with ERR_CONNECTION_REFUSED, which
# reads like a bug in the page rather than a missing process.
#
# That is not hypothetical: it is the single most repeated stumble in this
# repo's history. There was no `.env`, no `.env.example`, and no script that
# started both halves, so the two-terminal shape existed only as folklore.
#
# Pointing the web app at production instead does NOT work, and it is worth
# knowing why before trying: the API's CORS policy allows the console origin
# only, so a browser call from localhost is refused at the preflight. The API
# has to be local.
#
#   bun run dev          # from the repo root
#
# Ctrl-C stops everything, including the background API.

set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env.local if present — never committed, always wins.
if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
  echo "  env      .env.local"
fi

: "${DATABASE_URL:=postgres://counted:counted@localhost:5434/counted}"
: "${APP_URL:=http://localhost:3000}"
: "${API_PORT:=8080}"
export DATABASE_URL APP_URL

# --- the database ------------------------------------------------------------
if ! docker compose ps db --status running >/dev/null 2>&1 &&
   ! docker-compose ps db 2>/dev/null | grep -q "Up"; then
  echo "  database starting…"
  (docker compose up -d db || docker-compose up -d db) >/dev/null 2>&1 || {
    echo "  !! could not start the database."
    echo "     Is the container runtime up?  colima start"
    exit 1
  }
fi

# Wait for it to accept connections rather than racing the API's migration.
for _ in $(seq 1 30); do
  if docker exec counted-db-1 pg_isready -U counted >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "  database ready   ${DATABASE_URL%%\?*}"

# --- the API -----------------------------------------------------------------
# Killed on exit, including Ctrl-C, so a stale :8080 never outlives the session
# and confuses the next run.
cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PORT="$API_PORT" bun run --cwd apps/api dev &
API_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

if curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1; then
  echo "  api ready        http://localhost:${API_PORT}"
else
  echo "  !! the api did not come up — see the log above."
  echo "     Most often the schema failed to apply; the error names the statement."
  exit 1
fi

# --- the web app -------------------------------------------------------------
echo "  web starting     http://localhost:3000"
echo
exec bun run --cwd apps/web dev
