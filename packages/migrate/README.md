# @counted/migrate

Migration CLI for importing historical events into [Counted](https://counted.dev) from a
self-hosted Aptabase (ClickHouse) instance or a CSV export.

## Install

```bash
npx @counted/migrate --help
```

## Usage

### From a self-hosted Aptabase (ClickHouse)

Aptabase stores events in ClickHouse, and its `events` table holds every app — so scope the
import to your app id. Point at the ClickHouse HTTP interface (default port `8123`):

```bash
npx @counted/migrate \
  --source-clickhouse "http://default:PASSWORD@your-aptabase-host:8123" \
  --app-id "YOUR_APTABASE_APP_ID" \
  --target-key "ck_your_project_key" \
  --target-host "https://app.counted.dev" \
  --since "2025-01-01"
```

Find the app id in your Aptabase dashboard URL. Aptabase's split `string_props` /
`numeric_props` columns are recombined into a single Counted `props` object.

### From CSV

A CSV export with `timestamp, session_id, event_name, os_name, …` columns (and either a
`props` column or `string_props` / `numeric_props`):

```bash
npx @counted/migrate \
  --source-csv export.csv \
  --target-key "ck_your_project_key" \
  --target-host "https://app.counted.dev"
```

### Options

- `--source-clickhouse` — Aptabase ClickHouse HTTP URL (`http://user:pass@host:8123`)
- `--app-id` — Aptabase app id to import (required with `--source-clickhouse`)
- `--source-csv` — path to a CSV export
- `--target-key` — your Counted project key (`ck_…`)
- `--target-host` — Counted API host (default: https://counted.dev)
- `--since` — only import events at or after this timestamp
- `--dry-run` — print what would be imported without sending
- `--batch-size` — events per batch (default: 50)
- `--concurrency` — parallel batch uploads (default: 4)

## License

MIT
