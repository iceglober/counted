"""Counted analytics client."""

import atexit
import json
import platform
import threading
import time
import urllib.request
import uuid
from typing import Any

SDK_VERSION = "counted-python/0.1.0"
DEFAULT_HOST = "https://counted.dev"
DEFAULT_FLUSH_INTERVAL = 30.0
DEFAULT_MAX_BATCH_SIZE = 50

_global_client: "Analytics | None" = None


class Analytics:
    """Privacy-first event tracking. No cookies, no fingerprinting, no PII."""

    def __init__(
        self,
        project_key: str,
        host: str = DEFAULT_HOST,
        flush_interval: float = DEFAULT_FLUSH_INTERVAL,
        max_batch_size: int = DEFAULT_MAX_BATCH_SIZE,
        session_id: str | None = None,
        session_timeout: float = 1800.0,
    ):
        self.project_key = project_key
        self.host = host.rstrip("/")
        self.flush_interval = flush_interval
        self.max_batch_size = max_batch_size
        self.session_timeout = session_timeout

        self._buffer: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._enabled = True
        self._send_threads: list[threading.Thread] = []

        self._session_id = session_id or self._generate_session_id()
        self._last_activity = time.time()

        self._timer: threading.Timer | None = None
        self._start_timer()

        atexit.register(self.destroy)

    def track(self, event_name: str, props: dict[str, Any] | None = None) -> None:
        """Track an event with optional properties."""
        if not self._enabled:
            return

        event = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "sessionId": self._get_session_id(),
            "eventName": event_name,
            "systemProps": self._detect_system_props(),
            "props": props or {},
        }

        with self._lock:
            self._buffer.append(event)
            if len(self._buffer) >= self.max_batch_size:
                self._flush_locked()

    def flush(self) -> None:
        """Flush buffered events to the server."""
        with self._lock:
            self._flush_locked()

    def destroy(self) -> None:
        """Flush remaining events and stop the timer.

        Waits for in-flight sends to finish so short-lived processes (CLIs,
        scripts) don't lose events: the send threads are daemons and would be
        killed at interpreter exit otherwise.
        """
        self._stop_timer()
        self.flush()
        for t in list(self._send_threads):
            t.join(timeout=10)
        with self._lock:
            self._send_threads = [t for t in self._send_threads if t.is_alive()]

    def disable(self) -> None:
        """Disable tracking."""
        self._enabled = False
        with self._lock:
            self._buffer.clear()
        self._stop_timer()

    def enable(self) -> None:
        """Enable tracking."""
        self._enabled = True
        self._start_timer()

    def _flush_locked(self) -> None:
        """Flush buffer while holding the lock."""
        if not self._buffer:
            return

        batch = self._buffer[: self.max_batch_size]
        self._buffer = self._buffer[self.max_batch_size :]

        # Fire and forget in a thread to not block the caller. Keep a handle so
        # destroy() can wait for delivery before the process exits.
        self._send_threads = [t for t in self._send_threads if t.is_alive()]
        t = threading.Thread(target=self._send, args=(batch,), daemon=True)
        t.start()
        self._send_threads.append(t)

    def _send(self, events: list[dict[str, Any]]) -> None:
        """Send events to the Counted API."""
        url = f"{self.host}/api/v0/event"
        data = json.dumps(events).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Project-Key": self.project_key,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp.read()
        except Exception:
            pass  # Silently fail — analytics should never crash the host app

    def _get_session_id(self) -> str:
        now = time.time()
        if self.session_timeout > 0 and now - self._last_activity > self.session_timeout:
            self._session_id = self._generate_session_id()
        self._last_activity = now
        return self._session_id

    @staticmethod
    def _generate_session_id() -> str:
        ts = int(time.time())
        rand = uuid.uuid4().hex[:8]
        return f"{ts}.{rand}"

    @staticmethod
    def _detect_system_props() -> dict[str, Any]:
        return {
            "osName": platform.system() or None,
            "osVersion": platform.release() or None,
            "locale": None,
            "appVersion": None,
            "deviceModel": None,
            "sdkVersion": SDK_VERSION,
            "isDebug": False,
        }

    def _start_timer(self) -> None:
        if self._timer is not None:
            return

        def tick():
            self.flush()
            self._timer = None
            self._start_timer()

        self._timer = threading.Timer(self.flush_interval, tick)
        self._timer.daemon = True
        self._timer.start()

    def _stop_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None


# ─── Module-level convenience API ───────────────────────────────────────────────


def init(project_key: str, **kwargs: Any) -> Analytics:
    """Initialize the global analytics client."""
    global _global_client
    _global_client = Analytics(project_key=project_key, **kwargs)
    return _global_client


def track(event_name: str, props: dict[str, Any] | None = None) -> None:
    """Track an event on the global client."""
    if _global_client:
        _global_client.track(event_name, props)


def flush() -> None:
    """Flush the global client."""
    if _global_client:
        _global_client.flush()


def destroy() -> None:
    """Destroy the global client."""
    global _global_client
    if _global_client:
        _global_client.destroy()
        _global_client = None
