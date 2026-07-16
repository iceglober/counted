-- Country-level geography breakdown: nullable ISO 3166-1 alpha-2 country code,
-- derived from Cloudflare's CF-IPCountry header at ingest (the request IP is
-- never stored). Hand-written to avoid drizzle-kit meta/journal conflicts.
ALTER TABLE events ADD COLUMN IF NOT EXISTS country_code text;
