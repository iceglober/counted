# counted-go

Privacy-first analytics SDK for Go. No cookies, no fingerprinting, no PII. Zero dependencies.

## Install

```bash
go get github.com/iceglober/counted/packages/go
```

## Quick start

```go
package main

import counted "github.com/iceglober/counted/packages/go"

func main() {
    counted.Init(counted.Options{
        ProjectKey: "ck_...",
    })
    defer counted.DestroyGlobal()

    counted.TrackEvent("page_view", counted.EventProperties{"path": "/"})
    counted.TrackEvent("user_signup", counted.EventProperties{"plan": "free"})
}
```

## Class-based usage

```go
analytics := counted.New(counted.Options{
    ProjectKey:     "ck_...",
    Host:           "https://app.counted.dev",
    FlushInterval:  10 * time.Second,
    SessionTimeout: 0, // Never auto-reset (for agents)
    SessionID:      "my-agent-run-123",
})
defer analytics.Destroy()

analytics.Track("tool_use", counted.EventProperties{
    "tool":    "web_search",
    "outcome": "success",
})
```

## Agent usage

For long-running agents, set `SessionTimeout: 0` and provide an explicit `SessionID`:

```go
analytics := counted.New(counted.Options{
    ProjectKey:     "ck_...",
    SessionID:      runID,
    SessionTimeout: 0,
    FlushInterval:  10 * time.Second,
})
```

## Features

- Thread-safe buffer with background goroutine flush
- Configurable session timeout (0 for agents)
- Explicit session ID support
- System props detection (OS, locale)
- Zero external dependencies
- Graceful shutdown via `Destroy()`

## License

MIT
