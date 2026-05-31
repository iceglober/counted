# Deploy Counted to Railway

## Prerequisites

1. [Railway account](https://railway.app)
2. [Railway CLI](https://docs.railway.app/develop/cli): `npm install -g @railway/cli`
3. GitHub repository secrets configured

## Railway Setup

### 1. Create the project

```bash
railway login
railway init        # creates a new project
railway link        # links this repo
```

### 2. Add Postgres with TimescaleDB

```bash
railway add --plugin postgresql
```

Then in the Railway dashboard, connect to the database and run:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

The schema is pushed automatically on deploy via `bun run db:push` in the start command.

After the first deploy, create the hypertable:

```sql
SELECT create_hypertable('events', 'timestamp');
```

### 3. Set environment variables

In Railway dashboard → Variables:

```
DATABASE_URL          → (auto-set by Railway Postgres plugin)
BETTER_AUTH_SECRET    → (generate: openssl rand -base64 32)
BETTER_AUTH_URL       → https://counted.dev
NEXT_PUBLIC_BETTER_AUTH_URL → https://counted.dev
RESEND_API_KEY        → (from resend.com dashboard)
RESEND_FROM           → Counted <onboarding@auth.counted.dev>
```

### 4. Configure custom domain

In Railway dashboard → Settings → Domains:
- Add `counted.dev`
- Configure DNS: CNAME to the Railway-provided domain

### 5. GitHub Actions secrets

In GitHub → Settings → Secrets → Actions:

```
RAILWAY_TOKEN         → (from: railway tokens create)
```

## Manual Deploy

```bash
railway up
```

## CI/CD Flow

1. Push to `main` triggers CI (typecheck + build)
2. On CI pass, deploy workflow pushes to Railway
3. Railway builds the Docker image
4. Start command runs `bun run db:push` (migrations) then `bun server.js`
5. Health check hits `/api/health` — verifies DB connection
6. Traffic switches to new deployment

## Monitoring

- Health endpoint: `https://counted.dev/api/health`
- Railway dashboard: CPU, memory, request metrics
- Logs: `railway logs`
