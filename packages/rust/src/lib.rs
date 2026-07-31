//! # counted
//!
//! Privacy-first analytics for Rust. No cookies, no fingerprinting, no PII.
//!
//! ```no_run
//! let counted = counted::Counted::new("ck_live_...");
//!
//! counted.identify("user_42"); // optional, and always your own id
//! counted.track("page_view", Some(serde_json::json!({ "path": "/pricing" })));
//! counted.shutdown();
//! ```
//!
//! ## Two entry points
//!
//! [`Counted`] is the one to use: it supplies a real HTTP transport, the
//! system clock, and a background flush.
//!
//! [`client::Client`] takes those as arguments instead. That is what makes the
//! reliability layer — the queue, the retries, the jittered backoff —
//! verifiable by the cross-language conformance suite, which drives this
//! crate, the JavaScript reference, Python and Go through the same scenarios.
//! It is a poor thing to ask of somebody who wants to count page views, which
//! is why it is not the default.

pub mod client;
pub mod contract;
pub mod platform;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub use client::{Client, Diagnostic, Reply, Transport};
pub use platform::{detect_system, SDK_VERSION};

/// Re-exported because `serde_json::Value` is in this crate's public signatures
/// — [`Counted::track`] takes one — so `counted::serde_json::Value` always
/// names the version this crate expects, whatever a consumer's own tree
/// resolved. Add `serde_json` to your `Cargo.toml` as well if you want the
/// `json!` macro; the README's install block says so.
pub use serde_json;

/// Where events go unless you say otherwise. Self-hosted installations point
/// this at their own API.
pub const DEFAULT_ENDPOINT: &str = "https://api.counted.dev/v1/events";

/// Configuration. Only the key is required.
pub struct Options {
    /// A public ingest key. It ships in your binary; that is by design.
    pub key: String,
    pub endpoint: String,
    /// Reported in system properties, so a metric can be split by release.
    pub app_version: Option<String>,
    pub flush_interval: Duration,
}

impl Options {
    pub fn new(key: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            endpoint: DEFAULT_ENDPOINT.into(),
            app_version: None,
            flush_interval: Duration::from_millis(contract::FLUSH_INTERVAL_MS),
        }
    }

    pub fn endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    pub fn app_version(mut self, version: impl Into<String>) -> Self {
        self.app_version = Some(version.into());
        self
    }

    pub fn flush_interval(mut self, interval: Duration) -> Self {
        self.flush_interval = interval;
        self
    }
}

/// The client.
///
/// Cheap to clone, and every clone shares one queue — so cloning it into
/// threads is the intended way to use it rather than something to work around.
#[derive(Clone)]
pub struct Counted {
    inner: Arc<Client>,
    stop: Arc<AtomicBool>,
}

impl Counted {
    /// A client with the defaults: the real endpoint, a background flush.
    pub fn new(key: impl Into<String>) -> Self {
        Self::with_options(Options::new(key))
    }

    pub fn with_options(options: Options) -> Self {
        let key = options.key.clone();
        let inner = Arc::new(Client::new(
            options.key,
            options.endpoint,
            Arc::new(UreqTransport),
            Arc::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            }),
            // Not the `rand` crate: a jittered backoff needs an
            // unpredictable-enough number, not a cryptographic one, and a
            // near-zero-dependency SDK is easier to get approved than one that
            // pulls in a tree for it.
            Arc::new(weak_random),
            Some(detect_system(options.app_version.as_deref())),
        ));

        let stop = Arc::new(AtomicBool::new(false));

        // No key means no thread and no I/O. Analytics missing from a build is
        // not a reason for the build to misbehave.
        if !key.is_empty() {
            let ticking = Arc::clone(&inner);
            let stopping = Arc::clone(&stop);
            let interval = options.flush_interval;
            thread::spawn(move || loop {
                thread::sleep(interval);
                if stopping.load(Ordering::Relaxed) {
                    return;
                }
                ticking.flush();
            });
        }

        Self { inner, stop }
    }

    /// Attribute subsequent events to a person.
    ///
    /// The only way a durable identity enters Counted, and it is always your
    /// own id — we never derive, infer or invent one. Pass something opaque:
    /// the server refuses anything that looks like an email address.
    pub fn identify(&self, user_id: &str) {
        self.inner.identify(user_id);
    }

    /// Forget the person and start a new visit. For sign-out.
    pub fn reset(&self) {
        self.inner.reset();
    }

    pub fn track(&self, name: &str, properties: Option<serde_json::Value>) {
        self.inner.track(name, properties);
    }

    /// Send what is queued, now.
    pub fn flush(&self) {
        self.inner.flush();
    }

    /// Stop the background flush, after one last send.
    ///
    /// Worth calling before a short-lived process exits — otherwise it exits
    /// with events still in the queue.
    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::Relaxed);
        self.inner.shutdown();
    }

    /// Anything a developer should see: a refused batch, a dropped event, a
    /// quota warning. Draining, so each is reported once.
    pub fn take_diagnostics(&self) -> Vec<Diagnostic> {
        self.inner.take_diagnostics()
    }
}

impl Drop for Counted {
    fn drop(&mut self) {
        // Only when the last handle goes. Flushing on every clone's drop would
        // send a batch each time one crossed a thread boundary.
        if Arc::strong_count(&self.inner) == 1 {
            self.shutdown();
        }
    }
}

/// The only I/O in the crate.
struct UreqTransport;

impl Transport for UreqTransport {
    fn send(&self, url: &str, key: &str, body: &str) -> Result<Reply, String> {
        let sent = ureq::post(url)
            .set("content-type", "application/json")
            .set("authorization", &format!("Bearer {key}"))
            .timeout(Duration::from_millis(contract::REQUEST_TIMEOUT_MS))
            .send_string(body);

        let response = match sent {
            Ok(response) => response,
            // An HTTP error is an answer, not a failure: its body carries
            // whether resending can help. Treating it as an error is how the
            // previous SDK made a 401 indistinguishable from success.
            Err(ureq::Error::Status(_, response)) => response,
            Err(transport) => return Err(transport.to_string()),
        };

        let status = response.status();
        let mut headers = Vec::new();
        for name in response.headers_names() {
            if let Some(value) = response.header(&name) {
                headers.push((name.to_lowercase(), value.to_string()));
            }
        }

        let text = response.into_string().unwrap_or_default();
        // A body that is not JSON is not an error — a proxy answering for the
        // server sends HTML, and the status still means something.
        let body = serde_json::from_str(&text).ok();

        Ok(Reply { status, headers, body })
    }
}

/// Enough randomness for a backoff jitter, and nothing more.
///
/// Seeded from the clock and the address of a stack local, so two processes
/// starting in the same millisecond do not retry in lockstep.
fn weak_random() -> f64 {
    use std::cell::Cell;
    thread_local! {
        static STATE: Cell<u64> = const { Cell::new(0) };
    }
    STATE.with(|state| {
        let mut seed = state.get();
        if seed == 0 {
            let local = 0u8;
            seed = (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64)
                ^ (&local as *const u8 as u64);
            // xorshift is fixed at zero, so a zero seed must never survive.
            if seed == 0 {
                seed = 0x9E37_79B9_7F4A_7C15;
            }
        }
        // xorshift64: small, fast, and adequate for jitter.
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        state.set(seed);
        (seed >> 11) as f64 / (1u64 << 53) as f64
    })
}
