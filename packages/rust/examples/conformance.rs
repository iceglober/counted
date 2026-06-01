//! Rust SDK conformance driver. Invoked as a subprocess by the conformance
//! orchestrator:
//!   COUNTED_KEY=ck_... COUNTED_HOST=http://127.0.0.1:PORT \
//!     cargo run -q --example conformance -- <scenario>
use counted::{Analytics, Options};
use std::collections::HashMap;

fn main() {
    let scenario = std::env::args().nth(1).expect("scenario arg required");
    let key = std::env::var("COUNTED_KEY").expect("COUNTED_KEY");
    let host = std::env::var("COUNTED_HOST").expect("COUNTED_HOST");

    match scenario.as_str() {
        "flush" => {
            let a = Analytics::with_options(Options {
                project_key: key,
                host,
                session_id: Some("conf-sess".into()),
                ..Default::default()
            });
            let mut p1 = HashMap::new();
            p1.insert("n".into(), serde_json::json!(1));
            a.track("alpha", Some(p1));
            let mut p2 = HashMap::new();
            p2.insert("n".into(), serde_json::json!(2));
            a.track("beta", Some(p2));
            a.flush();
        }
        "batch" => {
            let a = Analytics::with_options(Options {
                project_key: key,
                host,
                max_batch_size: 3,
                ..Default::default()
            });
            a.track("e1", None);
            a.track("e2", None);
            a.track("e3", None); // hits the cap -> auto flush
            a.flush();
        }
        "exit" => {
            let a = Analytics::with_options(Options {
                project_key: key,
                host,
                ..Default::default()
            });
            a.track("onexit", None);
            // No flush(): the Drop impl flushes when `a` leaves scope.
        }
        other => panic!("unknown scenario: {other}"),
    }
}
