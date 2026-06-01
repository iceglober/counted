//! # counted
//!
//! Privacy-first analytics SDK for Rust. No cookies, no fingerprinting, no PII.
//!
//! ```rust
//! use counted::Analytics;
//! use std::collections::HashMap;
//!
//! let analytics = Analytics::new("ck_YOUR_PROJECT_KEY");
//! let mut props = HashMap::new();
//! props.insert("path".into(), serde_json::Value::String("/".into()));
//! analytics.track("page_view", Some(props));
//! analytics.flush();
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_HOST: &str = "https://counted.dev";
const DEFAULT_FLUSH_INTERVAL: Duration = Duration::from_secs(30);
const DEFAULT_MAX_BATCH_SIZE: usize = 50;
const DEFAULT_SESSION_TIMEOUT: Duration = Duration::from_secs(1800);
const SDK_VERSION: &str = "counted-rust/0.1.0";

/// Event properties map.
pub type EventProperties = HashMap<String, serde_json::Value>;

/// Configuration for the analytics client.
pub struct Options {
    pub project_key: String,
    pub host: String,
    pub flush_interval: Duration,
    pub max_batch_size: usize,
    pub session_id: Option<String>,
    pub session_timeout: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            project_key: String::new(),
            host: DEFAULT_HOST.into(),
            flush_interval: DEFAULT_FLUSH_INTERVAL,
            max_batch_size: DEFAULT_MAX_BATCH_SIZE,
            session_id: None,
            session_timeout: DEFAULT_SESSION_TIMEOUT,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SystemProps {
    os_name: Option<String>,
    os_version: Option<String>,
    locale: Option<String>,
    app_version: Option<String>,
    device_model: Option<String>,
    sdk_version: String,
    is_debug: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RawEvent {
    timestamp: String,
    session_id: String,
    event_name: String,
    system_props: SystemProps,
    props: EventProperties,
}

struct SessionState {
    id: String,
    last_activity: Instant,
    timeout: Duration,
}

/// Analytics client. Thread-safe.
pub struct Analytics {
    project_key: String,
    host: String,
    max_batch_size: usize,
    buffer: Arc<Mutex<Vec<RawEvent>>>,
    session: Arc<Mutex<SessionState>>,
}

impl Analytics {
    /// Create a new analytics client with just a project key.
    pub fn new(project_key: &str) -> Self {
        Self::with_options(Options {
            project_key: project_key.into(),
            ..Default::default()
        })
    }

    /// Create a new analytics client with full options.
    pub fn with_options(opts: Options) -> Self {
        let session_id = opts.session_id.unwrap_or_else(generate_session_id);

        Self {
            project_key: opts.project_key,
            host: opts.host,
            max_batch_size: opts.max_batch_size,
            buffer: Arc::new(Mutex::new(Vec::new())),
            session: Arc::new(Mutex::new(SessionState {
                id: session_id,
                last_activity: Instant::now(),
                timeout: opts.session_timeout,
            })),
        }
    }

    /// Track an event with optional properties.
    pub fn track(&self, event_name: &str, props: Option<EventProperties>) {
        let event = RawEvent {
            timestamp: now_iso(),
            session_id: self.get_session_id(),
            event_name: event_name.into(),
            system_props: detect_system_props(),
            props: props.unwrap_or_default(),
        };

        let should_flush;
        {
            let mut buf = self.buffer.lock().unwrap();
            buf.push(event);
            should_flush = buf.len() >= self.max_batch_size;
        }

        if should_flush {
            self.flush();
        }
    }

    /// Flush all buffered events to the server.
    pub fn flush(&self) {
        let batch: Vec<RawEvent>;
        {
            let mut buf = self.buffer.lock().unwrap();
            if buf.is_empty() {
                return;
            }
            batch = buf.drain(..).collect();
        }
        self.send(&batch);
    }

    fn get_session_id(&self) -> String {
        let mut session = self.session.lock().unwrap();
        let now = Instant::now();

        if session.timeout > Duration::ZERO
            && now.duration_since(session.last_activity) > session.timeout
        {
            session.id = generate_session_id();
        }
        session.last_activity = now;
        session.id.clone()
    }

    fn send(&self, events: &[RawEvent]) {
        let url = format!("{}/api/v0/event", self.host);
        let body = match serde_json::to_string(events) {
            Ok(b) => b,
            Err(_) => return,
        };

        let _ = ureq::post(&url)
            .set("Content-Type", "application/json")
            .set("Project-Key", &self.project_key)
            .send_string(&body);
    }
}

impl Drop for Analytics {
    fn drop(&mut self) {
        self.flush();
    }
}

fn generate_session_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let rand: u32 = (ts as u32).wrapping_mul(2654435761); // simple hash
    format!("{}.{:08x}", ts, rand)
}

fn now_iso() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let millis = d.subsec_millis();

    let total_days = secs / 86400;
    let day_secs = secs % 86400;
    let hours = day_secs / 3600;
    let minutes = (day_secs % 3600) / 60;
    let seconds = day_secs % 60;

    // Approximate date calculation (good enough for timestamps)
    let mut y = 1970i64;
    let mut remaining = total_days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for &md in &month_days {
        if remaining < md as i64 { break; }
        remaining -= md as i64;
        m += 1;
    }

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m + 1, remaining + 1, hours, minutes, seconds, millis
    )
}

fn detect_system_props() -> SystemProps {
    SystemProps {
        os_name: Some(std::env::consts::OS.into()),
        os_version: None,
        locale: std::env::var("LANG").ok(),
        app_version: None,
        device_model: None,
        sdk_version: SDK_VERSION.into(),
        is_debug: cfg!(debug_assertions),
    }
}
