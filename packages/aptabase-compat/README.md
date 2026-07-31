# @counted/aptabase-compat

Edge translation for Aptabase-shaped clients. Not user-facing.

A customer with Aptabase's SDK in a shipped mobile app cannot redeploy it to
try Counted. `POST /api/v0/event` accepts what that SDK already sends,
translates it here, and runs **the same ingest path as `POST /v1/events`** —
same admission, same dedup, same quota, same writer.

## The boundary

Their vocabulary — `eventName`, `sessionId`, `systemProps`, `appBuildNumber`,
`A-US-…` — exists in this package and nowhere else. A test walks the source
tree and fails if any of it appears in the domain, ports, application or
adapters.

That is why this is a package rather than a function in the API. v1 put
Aptabase's field names in its database columns, so a rename in their SDK would
have been a migration in ours.

## What the translation decides

| theirs | ours | why |
|---|---|---|
| `eventName` | `name` | a rename |
| `sessionId` | `visitId` | both are ephemeral activity groupings; neither is an identity, and Counted will not treat one as an identity |
| `systemProps.osName` | `systemProperties.os_name` | renamed, then canonicalised downstream — their `iOS` is stored as `ios` |
| `isDebug`, `appBuildNumber` | event properties | no column exists; dropping data somebody already sends is the worse failure |
| a nested `props` value | dropped | `"[object Object]"` looks like data |
| an unparseable `timestamp` | absent | the server stamps arrival and warns; a guessed instant would poison the dedup key |

One bad event refuses the whole batch, because their SDK retries the batch it
sent and partially accepting would double-count the rest.

## Responses

Aptabase's shape, not ours: `200` with an empty body on success. A client
written against Aptabase never reads the body and would discard our receipt —
which is real, and is in the log.

Everything else under `/api/v0/` answers `410 Gone` with
`Link: </v1/openapi.json>; rel="successor-version"`. Not `404`: these endpoints
existed, and "gone" versus "wrong URL" sends somebody to a different place.
