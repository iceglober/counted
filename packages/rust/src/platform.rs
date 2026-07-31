//! Canonical platform detection.
//!
//! SDK-070/071. The value sent is the closed enum the server stores —
//! `macos`, not `darwin`. One macOS machine used to report four different
//! values depending on which SDK was running: `macOS` from JavaScript,
//! `darwin` from Go, `Mac OS X` from a user-agent, `macos` from Rust. All four
//! landed in the same column, so every breakdown by operating system showed
//! macOS four times with the traffic split between them.
//!
//! The alias table is generated from `contract/gen/contract.json`, so the four
//! languages cannot disagree about the mapping — and the conformance suite
//! asserts they agree about the *result*, on the same machine, which is the
//! test whose absence let this happen.

use crate::contract::OS_ALIASES;

pub const SDK_VERSION: &str = "counted-rust/2.0.0";

/// Map anything to the closed set. Unrecognised becomes `other` rather than
/// passing through, because a value that passes through is how one OS becomes
/// four.
pub fn canonical_os(raw: &str) -> &'static str {
    if raw.is_empty() {
        return "other";
    }
    let stripped: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();

    OS_ALIASES
        .iter()
        .find(|(alias, _)| *alias == stripped)
        .map(|(_, canonical)| *canonical)
        .unwrap_or("other")
}

/// What `std::env::consts::OS` calls this platform, before mapping.
pub fn raw_os() -> &'static str {
    std::env::consts::OS
}

/// The context every event carries.
pub fn detect_system(app_version: Option<&str>) -> serde_json::Value {
    let raw = raw_os();
    serde_json::json!({
        "os_name": canonical_os(raw),
        "os_version": serde_json::Value::Null,
        "locale": detect_locale(),
        "app_version": app_version,
        "sdk_version": SDK_VERSION,
        // SDK-070: kept rather than discarded, so a platform nobody has
        // mapped yet is discoverable instead of silently becoming "other".
        "os_name_raw": raw,
    })
}

fn detect_locale() -> Option<String> {
    for name in ["LC_ALL", "LANG"] {
        if let Ok(raw) = std::env::var(name) {
            if !raw.is_empty() {
                // "en_GB.UTF-8" is not a locale tag. Take the tag, drop the
                // encoding, and use the separator the wire expects.
                let tag = raw.split('.').next().unwrap_or(&raw);
                return Some(tag.replace('_', "-"));
            }
        }
    }
    None
}
