// Generated from contract/gen/contract.json. Do not edit.
// Run `bun run contract:generate` and commit the result.

pub const CONTRACT_VERSION: &str = "2026-08-01";

pub const OS_NAMES: [&str; 12] = ["macos", "windows", "linux", "ios", "ipados", "android", "tvos", "watchos", "visionos", "chromeos", "freebsd", "other"];

pub const OS_ALIASES: [(&str, &str); 35] = [
    ("macos", "macos"),
    ("macosx", "macos"),
    ("mac", "macos"),
    ("darwin", "macos"),
    ("osx", "macos"),
    ("windows", "windows"),
    ("win", "windows"),
    ("win32", "windows"),
    ("win64", "windows"),
    ("winnt", "windows"),
    ("linux", "linux"),
    ("gnulinux", "linux"),
    ("ubuntu", "linux"),
    ("debian", "linux"),
    ("fedora", "linux"),
    ("arch", "linux"),
    ("ios", "ios"),
    ("iphoneos", "ios"),
    ("iphone", "ios"),
    ("ipados", "ipados"),
    ("ipad", "ipados"),
    ("android", "android"),
    ("tvos", "tvos"),
    ("appletvos", "tvos"),
    ("watchos", "watchos"),
    ("visionos", "visionos"),
    ("xros", "visionos"),
    ("chromeos", "chromeos"),
    ("chromiumos", "chromeos"),
    ("cros", "chromeos"),
    ("freebsd", "freebsd"),
    ("openbsd", "freebsd"),
    ("netbsd", "freebsd"),
    ("other", "other"),
    ("unknown", "other"),
];

pub const FLUSH_INTERVAL_MS: u64 = 5000;
pub const MAX_BATCH_SIZE: u64 = 50;
pub const MAX_BUFFER_EVENTS: u64 = 1000;
pub const VISIT_TIMEOUT_MS: u64 = 1800000;
pub const REQUEST_TIMEOUT_MS: u64 = 15000;
pub const MAX_BODY_BYTES: u64 = 1048576;

pub const BACKOFF_BASE_MS: u64 = 500;
pub const BACKOFF_MAX_MS: u64 = 60000;
pub const BACKOFF_FACTOR: u64 = 2;

pub const RETRYABLE_STATUSES: [u16; 7] = [408, 425, 429, 500, 502, 503, 504];

pub const FATAL_STATUSES: [u16; 2] = [401, 403];
