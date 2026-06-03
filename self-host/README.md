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

## First-Time Setup

After the first start, the database schema is created automatically. You need to create the TimescaleDB hypertable once:

```bash
docker compose exec db psql -U counted -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker compose exec db psql -U counted -c "SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE);"
```

## Sign In

Go to `http://localhost:3000/login` and enter your email.

**Without Resend configured:** The magic link token is saved in the database. Retrieve it:
```bash
docker compose exec db psql -U counted -c "SELECT identifier FROM verification ORDER BY created_at DESC LIMIT 1;"
```
Then visit: `http://localhost:3000/api/auth/magic-link/verify?token=<TOKEN>&callbackURL=/dashboards`

**With Resend configured:** The magic link arrives in your email.

## Production Checklist

- [ ] Set a strong `BETTER_AUTH_SECRET` and `POSTGRES_PASSWORD`
- [ ] Set `BASE_URL` to your public URL
- [ ] Configure Resend for email delivery
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

## Resource Requirements

- **Minimum:** 1 vCPU, 1GB RAM
- **Recommended:** 2 vCPU, 2GB RAM
- **Storage:** ~600 bytes per event (with indexes). 1M events ≈ 600MB.

## License

MIT — same as the cloud version. No feature restrictions.
