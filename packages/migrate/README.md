# @counted/migrate

Migration CLI for importing historical events into [Counted](https://counted.dev) from Aptabase or CSV.

## Install

```bash
npx @counted/migrate --help
```

## Usage

### From CSV

```bash
npx @counted/migrate \
  --source-csv export.csv \
  --target-key "A-US-..." \
  --target-host "https://app.counted.dev"
```

### From Aptabase Postgres (self-hosted)

```bash
npx @counted/migrate \
  --source-db "postgres://aptabase:..." \
  --target-key "A-US-..." \
  --target-host "https://app.counted.dev" \
  --since "2025-01-01"
```

### Options

- `--source-csv` — path to CSV file
- `--source-db` — Aptabase Postgres connection string
- `--target-key` — your Counted project key
- `--target-host` — Counted API host (default: https://counted.dev)
- `--since` — only import events after this date
- `--dry-run` — print what would be imported without sending
- `--batch-size` — events per batch (default: 50)
- `--concurrency` — parallel batch uploads (default: 4)

## License

MIT
