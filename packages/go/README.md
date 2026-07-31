# counted (Go)

Privacy-first analytics for Go. No cookies, no fingerprinting, no PII, and no
dependencies outside the standard library.

## Install

```bash
go get github.com/iceglober/counted/packages/go/v2
```

## Quick start

```go
package main

import counted "github.com/iceglober/counted/packages/go/v2"

func main() {
	c := counted.New(counted.Options{Key: "ck_live_..."})
	defer c.Shutdown()

	c.Track("page_view", map[string]any{"path": "/pricing"})
}
```

`Shutdown` is worth deferring: without it a short-lived process exits with
events still queued.

## Identity

Counted never derives, infers or invents an identity. `Identify` is the only way
one enters the system, and the id is always yours:

```go
c.Identify("user_42") // opaque — not an email; the server refuses those
c.Track("plan_upgraded", map[string]any{"plan": "pro"})

c.Reset() // sign-out: forget the person, start a new visit
```

Without `Identify`, events are grouped by an in-memory visit id that expires
after 30 minutes idle. A visit is an activity grouping, not an identity.

## Options

| Field | Meaning |
|---|---|
| `Key` | Your public ingest key. It ships in your binary; that is by design. |
| `Endpoint` | Override for self-hosting. Defaults to `counted.DefaultEndpoint`. |
| `AppVersion` | Reported in system properties, so a metric can be split by release. |
| `FlushInterval` | How often the queue is sent. Defaults to the contract value. |
| `HTTPClient` | Your own `*http.Client` — a proxy, a different timeout, a test. |

An empty `Key` returns a client that discards everything, so analytics missing
from a build is not a reason for the build to misbehave.

## Reliability

The queue, the retries and the jittered backoff are specified in
`contract/sdk-behaviour.md` and verified by a cross-language conformance suite
that drives this SDK, the JavaScript reference, Python and Rust through the same
scenarios. A batch that fails goes back to the head of the queue, `Retry-After`
is honoured, and a credential error disables the client rather than retrying
forever.

`NewClient` takes an injected transport, clock and source of randomness. That is
what makes the behaviour above testable; `New` supplies the real ones.
