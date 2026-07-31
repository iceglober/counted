//! The Rust SDK's reliability layer.
//!
//! Behaviour is specified in `contract/sdk-behaviour.md` and enforced by the
//! cross-language conformance suite: the same scenario files drive this, the
//! JavaScript reference, Python and Go, and CI will not merge until all four
//! agree.
//!
//! What was here before had no retry, no re-queue and no status handling — a
//! `let _ = ...` around the send, so a failed flush dropped its events and
//! reported nothing. There was also no background flush timer at all. None of
//! that was hard to write; nobody was ever told it was wrong.
//!
//! The clock, the transport and the randomness are injectable. Not for
//! elegance — it is the only way the conformance driver can control time and
//! failures, and behaviour that cannot be driven cannot be verified.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::contract::{
    BACKOFF_BASE_MS, BACKOFF_FACTOR, BACKOFF_MAX_MS, FATAL_STATUSES, MAX_BATCH_SIZE,
    MAX_BUFFER_EVENTS, RETRYABLE_STATUSES, VISIT_TIMEOUT_MS,
};

/// What the transport gives back. An HTTP error is an answer, not a failure.
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Option<serde_json::Value>,
}

/// Injectable so the conformance driver can script failures.
pub trait Transport: Send + Sync {
    fn send(&self, url: &str, key: &str, body: &str) -> Result<Reply, String>;
}

#[derive(Clone, Debug, PartialEq)]
pub struct QueuedEvent {
    pub name: String,
    pub visit_id: String,
    pub occurred_at: String,
    pub idempotency_key: String,
    pub user_id: Option<String>,
    pub properties: Option<serde_json::Value>,
    pub system_properties: Option<serde_json::Value>,
}

impl QueuedEvent {
    fn to_wire(&self) -> serde_json::Value {
        let mut wire = serde_json::Map::new();
        wire.insert("name".into(), self.name.clone().into());
        wire.insert("visitId".into(), self.visit_id.clone().into());
        wire.insert("occurredAt".into(), self.occurred_at.clone().into());
        wire.insert("idempotencyKey".into(), self.idempotency_key.clone().into());
        // Absent, not null. The ingest contract makes these optional, and an
        // explicit null sends a value where it says send nothing.
        if let Some(user) = &self.user_id {
            wire.insert("userId".into(), user.clone().into());
        }
        if let Some(properties) = &self.properties {
            wire.insert("properties".into(), properties.clone());
        }
        if let Some(system) = &self.system_properties {
            wire.insert("systemProperties".into(), system.clone());
        }
        serde_json::Value::Object(wire)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Diagnostic {
    Dropped { events: usize },
    Rejected { events: u64 },
    Refused { status: u16 },
    Disabled { status: u16, discarded: usize },
}

struct State {
    buffer: VecDeque<QueuedEvent>,
    person: Option<String>,
    visit_id: Option<String>,
    visit_seen: u64,
    paused_until: u64,
    attempt: u32,
    disabled: bool,
    closed: bool,
    diagnostics: Vec<Diagnostic>,
}

pub struct Client {
    key: String,
    endpoint: String,
    transport: Arc<dyn Transport>,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    random: Arc<dyn Fn() -> f64 + Send + Sync>,
    system: Option<serde_json::Value>,
    max_batch: usize,
    max_buffer: usize,
    state: Mutex<State>,
}

impl Client {
    pub fn new(
        key: impl Into<String>,
        endpoint: impl Into<String>,
        transport: Arc<dyn Transport>,
        clock: Arc<dyn Fn() -> u64 + Send + Sync>,
        random: Arc<dyn Fn() -> f64 + Send + Sync>,
        system: Option<serde_json::Value>,
    ) -> Self {
        Self {
            key: key.into(),
            endpoint: endpoint.into(),
            transport,
            clock,
            random,
            system,
            max_batch: MAX_BATCH_SIZE as usize,
            max_buffer: MAX_BUFFER_EVENTS as usize,
            state: Mutex::new(State {
                buffer: VecDeque::new(),
                person: None,
                visit_id: None,
                visit_seen: 0,
                paused_until: 0,
                attempt: 0,
                disabled: false,
                closed: false,
                diagnostics: Vec::new(),
            }),
        }
    }

    /// SDK-001: never panics, never blocks, performs no I/O.
    pub fn track(&self, name: &str, properties: Option<serde_json::Value>) {
        let now = (self.clock)();
        let mut state = self.state.lock().unwrap();
        if state.closed || state.disabled {
            return;
        }

        let visit = self.current_visit(&mut state, now);
        let person = state.person.clone();
        state.buffer.push_back(QueuedEvent {
            name: name.to_string(),
            visit_id: visit,
            // SDK-010/011: minted and stamped now, reused verbatim on retry.
            // The server dedups on (key, instant), so regenerating either
            // double-counts.
            occurred_at: iso(now),
            idempotency_key: format!("{}-{}", now, ((self.random)() * 1e12) as u64),
            user_id: person,
            properties,
            system_properties: self.system.clone(),
        });
        Self::trim(&mut state, self.max_buffer);
    }

    /// SDK-060/061: the customer's own id. Never derived, inferred or hashed.
    pub fn identify(&self, user_id: &str) {
        let mut state = self.state.lock().unwrap();
        let trimmed = user_id.trim();
        state.person = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
    }

    /// SDK-062: forget the person and start a new visit.
    pub fn reset(&self) {
        let now = (self.clock)();
        let mut state = self.state.lock().unwrap();
        state.person = None;
        state.visit_id = Some(mint_visit(now, (self.random)()));
        state.visit_seen = now;
    }

    pub fn flush(&self) {
        let batch = {
            let mut state = self.state.lock().unwrap();
            if state.disabled || (self.clock)() < state.paused_until {
                return;
            }
            let take = state.buffer.len().min(self.max_batch);
            state.buffer.drain(..take).collect::<Vec<_>>()
        };
        if batch.is_empty() {
            return;
        }
        self.send(batch);
    }

    /// SDK-080: flush what is queued, then stop.
    pub fn shutdown(&self) {
        {
            let mut state = self.state.lock().unwrap();
            state.closed = true;
        }
        self.flush();
    }

    pub fn take_diagnostics(&self) -> Vec<Diagnostic> {
        std::mem::take(&mut self.state.lock().unwrap().diagnostics)
    }

    fn send(&self, batch: Vec<QueuedEvent>) {
        let events: Vec<serde_json::Value> = batch.iter().map(QueuedEvent::to_wire).collect();
        let body = serde_json::json!({ "events": events }).to_string();

        match self.transport.send(&self.endpoint, &self.key, &body) {
            // Not `let _ = ...`. Nothing was heard back, so nothing is known
            // about whether it landed: requeue and back off.
            Err(_) => {
                self.requeue(batch);
                self.backoff();
            }
            Ok(reply) => self.handle(reply, batch),
        }
    }

    fn handle(&self, reply: Reply, batch: Vec<QueuedEvent>) {
        if (200..300).contains(&reply.status) {
            // SDK-040: every per-event outcome settles. Only transport
            // failures and retryable statuses come back.
            let mut state = self.state.lock().unwrap();
            state.attempt = 0;
            if let Some(body) = &reply.body {
                if let Some(rejected) = body.get("rejected").and_then(|v| v.as_u64()) {
                    if rejected > 0 {
                        state.diagnostics.push(Diagnostic::Rejected { events: rejected });
                    }
                }
            }
            return;
        }

        if !retryable(&reply) {
            let mut state = self.state.lock().unwrap();
            if FATAL_STATUSES.contains(&reply.status) {
                // SDK-043: a credential that is missing or revoked will not
                // become valid by being asked again.
                let discarded = state.buffer.len();
                state.buffer.clear();
                state.disabled = true;
                state.diagnostics.push(Diagnostic::Disabled { status: reply.status, discarded });
                return;
            }
            state.diagnostics.push(Diagnostic::Refused { status: reply.status });
            return;
        }

        self.requeue(batch);
        match retry_after_ms(&reply) {
            // SDK-041: the server said when. Believe it.
            Some(ms) => {
                let now = (self.clock)();
                self.state.lock().unwrap().paused_until = now + ms;
            }
            None => self.backoff(),
        }
    }

    /// SDK-042: exponential, capped, full jitter.
    ///
    /// Without jitter every client that failed in one outage returns in the
    /// same millisecond and knocks the recovering server over again.
    fn backoff(&self) {
        let now = (self.clock)();
        let jitter = (self.random)();
        let mut state = self.state.lock().unwrap();
        state.attempt += 1;
        let ceiling = BACKOFF_MAX_MS
            .min(BACKOFF_BASE_MS * BACKOFF_FACTOR.pow(state.attempt.saturating_sub(1).min(20)));
        state.paused_until = now + (jitter * ceiling as f64) as u64;
    }

    /// SDK-021: back to the head, so ordering survives.
    fn requeue(&self, batch: Vec<QueuedEvent>) {
        let mut state = self.state.lock().unwrap();
        for event in batch.into_iter().rev() {
            state.buffer.push_front(event);
        }
        Self::trim(&mut state, self.max_buffer);
    }

    /// SDK-020/022: bounded on insert, dropping the oldest.
    fn trim(state: &mut State, max: usize) {
        if state.buffer.len() <= max {
            return;
        }
        let excess = state.buffer.len() - max;
        state.buffer.drain(..excess);
        state.diagnostics.push(Diagnostic::Dropped { events: excess });
    }

    /// SDK-050: rolls over after inactivity. Never an identity.
    fn current_visit(&self, state: &mut State, now: u64) -> String {
        let stale = state.visit_id.is_none()
            || (VISIT_TIMEOUT_MS > 0 && now.saturating_sub(state.visit_seen) > VISIT_TIMEOUT_MS);
        if stale {
            state.visit_id = Some(mint_visit(now, (self.random)()));
        }
        state.visit_seen = now;
        state.visit_id.clone().unwrap()
    }
}

/// SDK-044: the server's own answer wins; the status list is the fallback.
fn retryable(reply: &Reply) -> bool {
    if let Some(body) = &reply.body {
        if let Some(flag) = body.get("retryable").and_then(|v| v.as_bool()) {
            return flag;
        }
    }
    RETRYABLE_STATUSES.contains(&reply.status)
}

fn retry_after_ms(reply: &Reply) -> Option<u64> {
    reply
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("retry-after"))
        .and_then(|(_, value)| value.parse::<f64>().ok())
        .map(|seconds| (seconds * 1000.0) as u64)
}

fn mint_visit(now: u64, random: f64) -> String {
    format!("{}.{:x}", now / 1000, (random * (36f64).powi(8)) as u64)
}

/// Minimal ISO-8601 in UTC, without pulling in a date library — "no
/// dependencies" is a stated selling point in the README.
fn iso(millis: u64) -> String {
    let secs = (millis / 1000) as i64;
    let ms = millis % 1000;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60, ms
    )
}

/// Howard Hinnant's days-to-civil algorithm. Small, exact, and no dependency.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
