# counted (Python)

Privacy-first analytics for Python. No cookies, no fingerprinting, no PII, and
no dependencies outside the standard library.

## Install

```bash
pip install counted
```

## Quick start

```python
from counted import Counted

counted = Counted(key="ck_live_...")

counted.track("page_view", {"path": "/pricing"})

counted.shutdown()
```

`shutdown()` is worth calling before a short-lived process exits — otherwise it
exits with events still queued.

## Identity

Counted never derives, infers or invents an identity. `identify` is the only way
one enters the system, and the id is always yours:

```python
counted.identify("user_42")  # opaque — not an email; the server refuses those
counted.track("plan_upgraded", {"plan": "pro"})

counted.reset()  # sign-out: forget the person, start a new visit
```

Without `identify`, events are grouped by an in-memory visit id that expires
after 30 minutes idle. A visit is an activity grouping, not an identity.

## Options

```python
counted = Counted(
    key="ck_live_...",
    endpoint="https://counted.internal/v1/events",  # self-hosting
    app_version="1.4.0",
)
```

An empty key returns a client that discards everything, so analytics missing
from a deployment is not a reason for it to misbehave.

## Reliability

The queue, the retries and the jittered backoff are specified in
`contract/sdk-behaviour.md` and verified by a cross-language conformance suite
that drives this SDK, the JavaScript reference, Go and Rust through the same
scenarios. A batch that fails goes back to the head of the queue, `Retry-After`
is honoured, and a credential error disables the client rather than retrying
forever.

The transport, clock and source of randomness are injectable — that is what
makes the behaviour above testable — and default to the real ones.
