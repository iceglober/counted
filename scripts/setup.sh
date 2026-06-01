#!/bin/bash
set -e

echo "=== Counted Local Dev Setup ==="
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install from https://docker.com"; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "Bun is required. Install from https://bun.sh"; exit 1; }

# Start database
echo "Starting TimescaleDB..."
docker compose up -d
echo "Waiting for database..."
until docker compose exec -T db pg_isready -U counted >/dev/null 2>&1; do sleep 1; done
echo "Database ready."

# Install dependencies
echo ""
echo "Installing dependencies..."
bun install

# Create .env.local if missing
if [ ! -f .env.local ]; then
  echo ""
  echo "Creating .env.local..."
  cat > .env.local << 'EOF'
DATABASE_URL=postgres://counted:counted@localhost:5434/counted
BETTER_AUTH_SECRET=dev-secret-not-for-production-use-only
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
TRUSTED_ORIGINS=http://localhost:3000
RESEND_API_KEY=
RESEND_FROM=
EOF
  echo "Created .env.local (edit to add Resend key if needed)"
fi

# Build SDKs
echo ""
echo "Building SDKs..."
cd packages/sdk && bun run build && cd ../react && bun run build && cd ../..

# Seed database
echo ""
echo "Seeding database..."
bun scripts/seed.ts

echo ""
echo "=== Setup complete ==="
echo ""
echo "Start the dev server:"
echo "  bun run dev"
echo ""
echo "Login as test@counted.dev via magic link."
echo "To get the magic link token, check the DB:"
echo "  docker compose exec db psql -U counted -c \"SELECT identifier FROM verification ORDER BY created_at DESC LIMIT 1;\""
