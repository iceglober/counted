# SDK behaviour

Normative. Every clause has an id, and every id has at least one conformance
scenario in `contract/conformance/scenarios/`. A behaviour with no scenario is
not part of the contract, and a scenario with no clause is a test nobody agreed
to.

The point of numbering it is mechanical: Go, Python and Rust do not drift
because a retry loop is hard to write. They drift because nobody ever told them
they were wrong. Python has `except: pass`, Rust has `let _ =`, Go closes the
body and ignores it — and all three ship green. A numbered clause with a
scenario behind it is the thing that says no.

## Tracking

**SDK-001** `track()` never throws, never blocks, and performs no I/O.

**SDK-010** Every event carries an idempotency key minted at `track()` time. A
retry reuses it verbatim. Regenerating it turns the server's at-least-once
delivery into double counting.

**SDK-011** Every event carries the instant it was tracked. A retry never
re-stamps it. The server's dedup key is (key, instant), so re-stamping breaks
deduplication just as surely as a new key does.

## The queue

**SDK-020** The buffer is FIFO and bounded at `DEFAULTS.maxBufferEvents`.
Overflow drops the **oldest** and counts what it dropped; the count is reported
to the caller rather than kept quiet.

**SDK-021** A failed batch is returned to the buffer **head**, so ordering
survives a retry.

**SDK-022** The bound is enforced when an event is added, not when the buffer
is flushed. A cap checked only at flush time does nothing while the server is
down, which is the only time it matters.

## Flushing

**SDK-030** A flush happens when the buffer reaches `maxBatchSize`, when the
timer fires, when `flush()` is called, or at shutdown.

**SDK-031** Concurrent flushes do not send the same events twice. Overlapping
calls join the one in flight.

## Responses

**SDK-040** A 2xx receipt settles every event in the batch, whatever the
per-event outcome. Accepted, deduplicated and rejected all mean *stop holding
it* — only a transport failure or a retryable status returns events to the
buffer.

**SDK-041** A 429 honours `Retry-After`, in seconds or as an HTTP date. Absent,
it falls back to the backoff schedule.

**SDK-042** A retryable status backs off exponentially from `BACKOFF.baseMs` by
`BACKOFF.factor`, capped at `BACKOFF.maxMs`, with full jitter. Without jitter
every client that failed in one outage returns in the same millisecond.

**SDK-043** A fatal status (401, 403) disables the client: the buffer is
discarded, nothing further is sent, and it is logged exactly once. Retrying a
revoked key until the buffer fills helps nobody.

**SDK-044** Retryability is read from the response when the server states it,
and inferred from the status only when it does not.

## Identity

**SDK-060** `identify(userId)` attributes subsequent events to that person. It
is always the customer's own identifier.

**SDK-061** The SDK never derives, infers, hashes or persists an identifier.
There is no fingerprinting, and no identity is reconstructed from anything the
device happens to expose.

**SDK-062** `reset()` clears the person and starts a new visit. Continuing a
visit across sign-out groups the next person's events with the last one's.

## Visits

**SDK-050** A visit rolls over after `DEFAULTS.visitTimeoutMs` of inactivity,
or on `reset()`. A visit is not an identity and nothing derives one from it.

**SDK-051** Visit state is per-client, never global. Two clients in one process
do not share or clobber it.

## Context

**SDK-070** `os_name` is one of `OS_NAMES`. An unrecognised platform is
`other`, and the raw value is preserved rather than discarded.

**SDK-071** Detection works with no browser present, and reports the host
platform rather than `other` when running on a server runtime.

## Shutdown

**SDK-080** Shutdown flushes what is queued. In a browser the page-hide path
uses `sendBeacon` with the key as a query parameter, because `sendBeacon`
cannot set headers and it is the only way the last event of a session arrives.

**SDK-081** `track()` after shutdown is ignored rather than queued forever.

## The wire

**SDK-090** The request body is always `{ events: [...] }` — never a bare array
and never a single object. v1 sent a bare object for one event and an array for
several, so every consumer needed both paths.
