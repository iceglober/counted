//! The Rust conformance driver.
//!
//! Speaks the line protocol on stdin/stdout. Every assertion lives in the
//! runner; this only translates commands into SDK calls and reports what its
//! fake transport saw.
//!
//! A send **parks** until the runner supplies an answer, because a scenario
//! declares the response after asserting the request. So the flush runs on a
//! worker thread and the transport blocks on a channel the main loop feeds —
//! which is also how a real SDK behaves.

use std::io::{self, BufRead, Write};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use counted::client::{Client, Reply, Transport};

struct Scripted {
    requests: Mutex<Vec<serde_json::Value>>,
    answers: Mutex<Receiver<serde_json::Value>>,
}

impl Transport for Scripted {
    fn send(&self, url: &str, key: &str, body: &str) -> Result<Reply, String> {
        self.requests.lock().unwrap().push(serde_json::json!({
            "url": url,
            "headers": { "authorization": format!("Bearer {}", key) },
            "body": serde_json::from_str::<serde_json::Value>(body).unwrap(),
        }));

        // Parks here. The main loop keeps reading stdin, so a `respond` can
        // arrive and release it.
        let answer = self
            .answers
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap_or_else(|_| {
                serde_json::json!({ "status": 202, "body": { "accepted": 1, "deduplicated": 0, "rejected": 0 } })
            });

        if answer.get("networkError").and_then(|v| v.as_bool()).unwrap_or(false) {
            return Err("connection reset".into());
        }

        Ok(Reply {
            status: answer["status"].as_u64().unwrap_or(202) as u16,
            headers: answer
                .get("headers")
                .and_then(|h| h.as_object())
                .map(|h| {
                    h.iter()
                        .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                        .collect()
                })
                .unwrap_or_default(),
            body: answer.get("body").cloned().filter(|b| !b.is_null()),
        })
    }
}

fn main() {
    let (tx, rx): (Sender<serde_json::Value>, Receiver<serde_json::Value>) = channel();
    let transport = Arc::new(Scripted {
        requests: Mutex::new(Vec::new()),
        answers: Mutex::new(rx),
    });

    // 2026-03-17T15:00:00Z, advanced on command.
    let clock = Arc::new(Mutex::new(1_773_759_600_000u64));
    let clock_read = Arc::clone(&clock);

    let client = Arc::new(Client::new(
        "ck_conformance",
        "https://api.test/v1/events",
        Arc::clone(&transport) as Arc<dyn Transport>,
        Arc::new(move || *clock_read.lock().unwrap()),
        // Deterministic, so a jittered backoff is still assertable.
        Arc::new(|| 0.5),
        None,
    ));

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let message: serde_json::Value = serde_json::from_str(&line).unwrap();
        let mut reply = serde_json::json!({ "ok": true });

        match message["cmd"].as_str().unwrap_or("") {
            "track" => client.track(
                message["name"].as_str().unwrap_or(""),
                message.get("properties").cloned().filter(|p| !p.is_null()),
            ),
            "identify" => client.identify(message["userId"].as_str().unwrap_or("")),
            "reset" => client.reset(),
            "flush" | "advance" => {
                if message["cmd"] == "advance" {
                    *clock.lock().unwrap() += message["ms"].as_u64().unwrap_or(0);
                }
                let worker = Arc::clone(&client);
                thread::spawn(move || worker.flush());
                // Let it reach the transport before the next command lands.
                thread::sleep(Duration::from_millis(20));
            }
            "shutdown" => {
                let worker = Arc::clone(&client);
                thread::spawn(move || worker.shutdown());
                thread::sleep(Duration::from_millis(20));
            }
            "respond" => {
                let _ = tx.send(message.clone());
                // Let the parked worker take it and act on it. Deliberately
                // not a join: a worker parked on an unanswered request cannot
                // finish, and joining would deadlock.
                thread::sleep(Duration::from_millis(20));
            }
            "settle" => thread::sleep(Duration::from_millis(20)),
            "drain" => {
                let mut requests = transport.requests.lock().unwrap();
                reply = serde_json::json!({ "ok": true, "requests": requests.clone() });
                requests.clear();
            }
            _ => {}
        }

        writeln!(stdout, "{}", reply).unwrap();
        stdout.flush().unwrap();
    }
}
