# Self-Hosting Counted

Run Counted on your own infrastructure with Docker Compose.

## Quick Start

```bash
git clone https://github.com/iceglober/counted.git
cd counted/self-host
cp .env.example .env
```

Edit `.env`:
```bash
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BASE_URL=https://analytics.yourcompany.com
POSTGRES_PASSWORD=a-strong-password
```

Start:
```bash
docker compose up -d
```

Counted is now running at `http://localhost:3000`.

> **First start builds locally.** If the prebuilt image (`ghcr.io/iceglober/counted`)
> isn't available yet, Compose runs a full Next.js build on your machine — budget
> **~2GB RAM to build** (1GB is enough to run once built). Once an image is
> published, `docker compose pull` grabs it and skips the local build.

The database schema (including the TimescaleDB hypertable) is created
automatically on boot by the container's migration step — no manual `psql` needed.

## Sign In

Go to `http://localhost:3000/login` and enter your email.

**Without Resend configured:** The magic link is printed to the container logs. Open it:
```bash
docker compose logs app | grep "Magic link" -A1
```
Copy the printed URL into your browser to sign in.

**With Resend configured:** The magic link arrives in your email.

<sub>Fallback: if you can't read the logs, the token is also in the DB —
`docker compose exec db psql -U counted -c "SELECT identifier FROM verification ORDER BY created_at DESC LIMIT 1;"`
then visit `http://localhost:3000/api/auth/magic-link/verify?token=<TOKEN>&callbackURL=/dashboards`.</sub>

## Send your first event

By default the SDK ships events to the Counted cloud (`https://app.counted.dev`).
To point it at your self-hosted instance, set `host`:

```ts
import { Analytics } from "@counted/sdk";

const counted = new Analytics({
  projectKey: "ck_your_client_key",   // from Settings → Projects in your instance
  host: "https://analytics.yourcompany.com",
});

counted.track("page_view");
```

Or send one directly with curl:

```bash
curl -X POST https://analytics.yourcompany.com/api/v0/event \
  -H "Content-Type: application/json" \
  -H "Project-Key: ck_your_client_key" \
  -d '{"eventName":"page_view","sessionId":"test-session"}'
```

The same `host` option exists on `@counted/react` (`<AnalyticsProvider projectKey="…" host="…">`).
The agent plugins read it from the `COUNTED_AGENT_HOST` environment variable.

## Production Checklist

- [ ] Set a strong `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`
- [ ] Set `BASE_URL` to your public URL
- [ ] Configure Resend for email delivery
- [ ] Set `CRON_SECRET` (`openssl rand -hex 32`) to enable the alerts scheduler — without it the `cron` service is a harmless no-op and alerts never fire
- [ ] Put behind a reverse proxy (nginx, Caddy, Traefik) with TLS
- [ ] Set up database backups
- [ ] Optionally set `TRUSTED_ORIGINS` to your domain

## Reverse Proxy (Caddy example)

```
analytics.yourcompany.com {
    reverse_proxy localhost:3000
}
```

## Updating

```bash
cd counted/self-host
git pull
docker compose build
docker compose up -d
```

## Data

All data is stored in the `pgdata` Docker volume. To back up:
```bash
docker compose exec db pg_dump -U counted counted > backup.sql
```

To restore:
```bash
cat backup.sql | docker compose exec -T db psql -U counted counted
```

## Troubleshooting

Check container health and status:
```bash
docker compose ps
```
The `app` service reports `healthy` once `/api/health` responds (it waits for the
database and runs migrations first). If it stays `starting` or `unhealthy`, view
logs with `docker compose logs app`.

## Resource Requirements

- **Minimum:** 1 vCPU, 1GB RAM
- **Recommended:** 2 vCPU, 2GB RAM
- **Storage:** ~600 bytes per event (with indexes). 1M events ≈ 600MB.

## License

MIT — same as the cloud version. No feature restrictions.
