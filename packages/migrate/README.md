# @counted/migrate

Import historical events from Aptabase into Counted.

```bash
npx @counted/migrate --source-csv ./export.csv --target-key ck_live_...
npx @counted/migrate --source-clickhouse "https://user:pass@ch:8443/aptabase" \
  --app-id A-US-1234567890 --target-key ck_live_...
```

## What it reports

The importer reads the server's **receipt** for every batch and reports what
was actually stored — never what was attempted:

```
Imported:      12,480
Already there: 3,220
Refused:       4
  3 × occurredAt is 400 days old, beyond the ingestion window.
  1 × An event name is required.
```

**A refusal exits non-zero.** An import that silently loses history is the
failure this tool exists to avoid, and exiting 0 over a gap is how it would
happen — the previous version treated any 2xx as success and discarded the
body.

## Resuming is exact

Every imported event carries a key derived from the source row, so re-running
the same export — or resuming with `--since` after an interruption — stores
each event once. The tool tells you the resume point when it stops:

```
Migration interrupted. Resume with:
  --since "2026-07-01T10:05:00.000Z"
Events carry a deterministic key, so anything already imported will not be stored twice.
```

The second run of the same file reports `0 imported, N already there`, which is
what a working resume looks like.

## What it translates

Their export shape is read here and nowhere else — this is one of two sealed
Aptabase boundaries (the other is `@counted/aptabase-compat`, for live clients).

| theirs | ours |
|---|---|
| `session_id` | `visitId` — an ephemeral grouping, never an identity |
| `event_name` | `name` |
| `string_props` + `numeric_props` | merged into `properties` |
| `os_name` etc. | `systemProperties`, canonicalised downstream (`iOS` → `ios`) |

`sdk_version` defaults to `aptabase-import`, so an imported event is
distinguishable from one a live SDK sent.

## Options

| flag | meaning |
|---|---|
| `--source-csv` / `--source-clickhouse` | where to read from; one is required |
| `--app-id` | required with ClickHouse — their `events` table holds every app |
| `--target-key` | a Counted ingest key (`ck_…`) |
| `--target-host` | defaults to `https://api.counted.dev` |
| `--since` | resume point, an ISO instant |
| `--dry-run` | read and translate, send nothing |
| `--batch-size`, `--concurrency` | tuning |
