# counted (Rust)

Privacy-first analytics for Rust. No cookies, no fingerprinting, no PII.

## Install

The crate publishes as `counted-sdk`; the library is imported as `counted`.
crates.io has no scopes and `counted` belongs to an unrelated crate.

```toml
[dependencies]
counted-sdk = "2"
```

## Quick start

```rust
fn main() {
    let counted = counted::Counted::new("ck_live_...");

    counted.track("page_view", Some(serde_json::json!({ "path": "/pricing" })));

    counted.shutdown();
}
```

`Counted` is cheap to clone and every clone shares one queue, so cloning it into
threads is the intended way to use it. The last handle to drop flushes.

## Identity

Counted never derives, infers or invents an identity. `identify` is the only way
one enters the system, and the id is always yours:

```rust
counted.identify("user_42"); // opaque — not an email; the server refuses those
counted.track("plan_upgraded", Some(serde_json::json!({ "plan": "pro" })));

counted.reset(); // sign-out: forget the person, start a new visit
```

Without `identify`, events are grouped by an in-memory visit id that expires
after 30 minutes idle. A visit is an activity grouping, not an identity.

## Options

```rust
let counted = counted::Counted::with_options(
    counted::Options::new("ck_live_...")
        .endpoint("https://counted.internal/v1/events") // self-hosting
        .app_version("1.4.0"),
);
```

An empty key returns a client that starts no thread and performs no I/O.

## Reliability

The queue, the retries and the jittered backoff are specified in
`contract/sdk-behaviour.md` and verified by a cross-language conformance suite
that drives this crate, the JavaScript reference, Python and Go through the same
scenarios. A batch that fails goes back to the head of the queue, `Retry-After`
is honoured, and a credential error disables the client rather than retrying
forever.

`client::Client` takes an injected transport, clock and source of randomness.
That is what makes the behaviour above testable; `Counted` supplies the real
ones.

## Diagnostics

Nothing is silent. `take_diagnostics()` drains anything a developer should see —
a refused batch, a dropped event, a quota warning — each reported once.
