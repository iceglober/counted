"""Generated from contract/gen/contract.json. Do not edit.
Run `bun run contract:generate` and commit the result."""

CONTRACT_VERSION = "2026-08-01"

OS_NAMES = ["macos","windows","linux","ios","ipados","android","tvos","watchos","visionos","chromeos","freebsd","other"]

OS_ALIASES = {
    "macos": "macos",
    "macosx": "macos",
    "mac": "macos",
    "darwin": "macos",
    "osx": "macos",
    "windows": "windows",
    "win": "windows",
    "win32": "windows",
    "win64": "windows",
    "winnt": "windows",
    "linux": "linux",
    "gnulinux": "linux",
    "ubuntu": "linux",
    "debian": "linux",
    "fedora": "linux",
    "arch": "linux",
    "ios": "ios",
    "iphoneos": "ios",
    "iphone": "ios",
    "ipados": "ipados",
    "ipad": "ipados",
    "android": "android",
    "tvos": "tvos",
    "appletvos": "tvos",
    "watchos": "watchos",
    "visionos": "visionos",
    "xros": "visionos",
    "chromeos": "chromeos",
    "chromiumos": "chromeos",
    "cros": "chromeos",
    "freebsd": "freebsd",
    "openbsd": "freebsd",
    "netbsd": "freebsd",
    "other": "other",
    "unknown": "other"
}

DEFAULTS = {
    "flushIntervalMs": 5000,
    "maxBatchSize": 50,
    "maxBufferEvents": 1000,
    "visitTimeoutMs": 1800000,
    "requestTimeoutMs": 15000,
    "maxBodyBytes": 1048576
}

BACKOFF = {
    "baseMs": 500,
    "maxMs": 60000,
    "factor": 2,
    "jitter": "full"
}

ENDPOINTS = {
    "ingest": "/v1/events"
}

RETRYABLE_STATUSES = [408,425,429,500,502,503,504]

FATAL_STATUSES = [401,403]
