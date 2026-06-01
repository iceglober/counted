# counted

Privacy-first analytics SDK for Python. No cookies, no fingerprinting, no PII. Zero dependencies.

## Install

```bash
pip install counted
```

## Quick start

```python
import counted

counted.init("ck_YOUR_PROJECT_KEY")

counted.track("page_view", {"path": "/"})
counted.track("user_signup", {"plan": "free"})
```

## Class-based usage

```python
from counted import Analytics

analytics = Analytics(
    project_key="ck_...",
    host="https://app.counted.dev",  # optional
    flush_interval=10.0,              # seconds, default 30
    session_timeout=0,                # 0 = never auto-reset (for agents)
)

analytics.track("model_inference", {"model": "claude-sonnet", "tokens": 1500})
analytics.flush()
analytics.destroy()
```

## Agent usage

For long-running AI agents, disable session auto-reset:

```python
analytics = Analytics(
    project_key="ck_...",
    session_id="my-agent-run-123",  # explicit session ID
    session_timeout=0,               # never auto-reset
    flush_interval=10.0,             # flush every 10s
)

analytics.track("tool_use", {"tool": "web_search", "outcome": "success"})
analytics.track("task_complete", {"duration_ms": 45000})
```

## What it does NOT do

- Set cookies or use any persistent storage
- Store IP addresses
- Fingerprint the runtime environment
- Require any external dependencies

## License

MIT
