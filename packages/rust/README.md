# counted

Privacy-first analytics SDK for Rust. No cookies, no fingerprinting, no PII.

## Install

The crate is published as `counted-sdk`; the library is imported as `counted`.

```toml
[dependencies]
counted-sdk = "0.1"
```

## Quick start

```rust
use counted::Analytics;

fn main() {
    let analytics = Analytics::new("ck_YOUR_PROJECT_KEY");

    analytics.track("page_view", Some([("path".into(), "/".into())].into()));
    analytics.track("user_signup", Some([("plan".into(), "free".into())].into()));

    // Flushes automatically on drop, or call manually:
    analytics.flush();
}
```

## With options

```rust
use counted::{Analytics, Options};
use std::time::Duration;

let analytics = Analytics::with_options(Options {
    project_key: "ck_...".into(),
    host: "https://app.counted.dev".into(),
    flush_interval: Duration::from_secs(10),
    session_timeout: Duration::ZERO, // Never auto-reset (for agents)
    session_id: Some("my-agent-run".into()),
    ..Default::default()
});
```

## Features

- Thread-safe (Arc<Mutex> internally)
- Automatic flush on drop
- Configurable session timeout (0 for agents)
- Explicit session ID support
- System props detection (OS, locale)
- Minimal dependencies (serde, serde_json, ureq)

## License

MIT
