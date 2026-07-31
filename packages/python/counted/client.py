"""The Python SDK.

Behaviour is specified in ``contract/sdk-behaviour.md`` and enforced by the
conformance suite: the same scenario files drive this, the JavaScript
reference, Go and Rust, and CI will not merge until all four agree.

What was here before had the shape of a client and none of the reliability.
There was no retry, no re-queue, and a bare ``except: pass`` around the send —
so a failed flush dropped its events and reported success. That is the exact
failure the conformance suite exists to make unshippable: it was not hard to
write correctly, nobody was ever told it was wrong.

The clock and the transport are injectable. Not for elegance — it is the only
way the conformance driver can control time and failures, and behaviour that
cannot be driven cannot be verified.
"""

from __future__ import annotations

import json
import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol
from urllib import error, request

from ._contract import BACKOFF, DEFAULTS, FATAL_STATUSES, RETRYABLE_STATUSES
from .platform import detect_system


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]
    body: dict[str, Any] | None


class Transport(Protocol):
    def send(self, url: str, key: str, body: str) -> Response:
        """Deliver a batch. Raises on a transport failure."""


class HttpTransport:
    """The real one. Standard library only — no dependencies is a selling point."""

    def __init__(self, timeout_ms: int = DEFAULTS["requestTimeoutMs"]) -> None:
        self._timeout = timeout_ms / 1000

    def send(self, url: str, key: str, body: str) -> Response:
        req = request.Request(
            url,
            data=body.encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self._timeout) as raw:
                return Response(raw.status, dict(raw.headers), _read_json(raw.read()))
        except error.HTTPError as http_error:
            # An HTTP error is an answer, not a transport failure. Reading the
            # body is how `retryable` is learnt, and swallowing it here is what
            # made the old client retry a 401 forever.
            return Response(http_error.code, dict(http_error.headers), _read_json(http_error.read()))


def _read_json(raw: bytes) -> dict[str, Any] | None:
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


@dataclass
class _Event:
    name: str
    visit_id: str
    occurred_at: str
    idempotency_key: str
    user_id: str | None = None
    properties: dict[str, Any] | None = None
    system_properties: dict[str, Any] | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "name": self.name,
            "visitId": self.visit_id,
            "occurredAt": self.occurred_at,
            "idempotencyKey": self.idempotency_key,
        }
        # Absent, not null. The ingest contract makes these optional, and
        # sending an explicit null is sending a value where it says send none.
        if self.user_id is not None:
            wire["userId"] = self.user_id
        if self.properties is not None:
            wire["properties"] = self.properties
        if self.system_properties is not None:
            wire["systemProperties"] = self.system_properties
        return wire


class Counted:
    """SDK-001: track() never throws, never blocks, performs no I/O."""

    def __init__(
        self,
        key: str,
        endpoint: str = "https://api.counted.dev/v1/events",
        app_version: str | None = None,
        flush_interval_ms: int = DEFAULTS["flushIntervalMs"],
        max_batch_size: int = DEFAULTS["maxBatchSize"],
        max_buffer_events: int = DEFAULTS["maxBufferEvents"],
        visit_timeout_ms: int = DEFAULTS["visitTimeoutMs"],
        transport: Transport | None = None,
        clock: Callable[[], float] | None = None,
        random_source: Callable[[], float] | None = None,
        on_diagnostic: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self._key = key
        self._endpoint = endpoint
        self._max_batch = min(max_batch_size, 250)
        self._max_buffer = max_buffer_events
        self._visit_timeout_ms = visit_timeout_ms
        self._transport = transport or HttpTransport()
        self._clock = clock or (lambda: time.time() * 1000)
        self._random = random_source or random.random
        self._on_diagnostic = on_diagnostic

        self._lock = threading.Lock()
        self._buffer: list[_Event] = []
        self._dropped = 0
        self._person: str | None = None
        self._visit_id: str | None = None
        self._visit_seen = 0.0
        self._paused_until = 0.0
        self._attempt = 0
        self._disabled = False
        self._closed = False
        self._system = detect_system(app_version)

        self._timer: threading.Timer | None = None
        if flush_interval_ms > 0:
            self._interval = flush_interval_ms / 1000
            self._start_timer()
        else:
            self._interval = 0

    # ── public surface ──────────────────────────────────────────────────────

    def track(self, name: str, properties: dict[str, Any] | None = None) -> None:
        if self._closed or self._disabled:
            return
        with self._lock:
            self._buffer.append(
                _Event(
                    name=name,
                    visit_id=self._current_visit(),
                    # SDK-010/011: minted and stamped now, reused verbatim on
                    # every retry. The server dedups on (key, instant), so
                    # regenerating either double-counts.
                    occurred_at=_iso(self._clock()),
                    idempotency_key=str(uuid.uuid4()),
                    user_id=self._person,
                    properties=properties,
                    system_properties=self._system,
                )
            )
            self._trim_locked()
            full = len(self._buffer) >= self._max_batch
        if full:
            self.flush()

    def identify(self, user_id: str) -> None:
        """SDK-060/061: the customer's own id. Never derived, inferred or hashed."""
        trimmed = user_id.strip()
        self._person = trimmed or None

    def reset(self) -> None:
        """SDK-062: forget the person and start a new visit."""
        self._person = None
        with self._lock:
            self._visit_id = _mint_visit(self._clock(), self._random)
            self._visit_seen = self._clock()

    def flush(self) -> None:
        if self._disabled:
            return
        with self._lock:
            if self._clock() < self._paused_until:
                return
            batch = self._buffer[: self._max_batch]
            del self._buffer[: len(batch)]
        if not batch:
            return
        self._send(batch)

    def shutdown(self) -> None:
        """SDK-080: flush what is queued, then stop."""
        self._closed = True
        self._stop_timer()
        self.flush()

    # ── internals ───────────────────────────────────────────────────────────

    def _send(self, batch: list[_Event]) -> None:
        body = json.dumps({"events": [event.to_wire() for event in batch]})
        try:
            response = self._transport.send(self._endpoint, self._key, body)
        except Exception as failure:  # noqa: BLE001 — every transport failure is a retry
            # Not `except: pass`. Nothing was heard back, so nothing is known
            # about whether it landed: requeue and try again.
            self._requeue(batch)
            self._schedule_backoff()
            self._report({"kind": "retry", "status": 0, "detail": str(failure)})
            return

        if 200 <= response.status < 300:
            # SDK-040: every per-event outcome settles. Only transport
            # failures and retryable statuses come back.
            self._attempt = 0
            self._report_receipt(response.body)
            return

        retryable = _retryable(response)
        if not retryable:
            if response.status in FATAL_STATUSES:
                # SDK-043: a credential that is missing or revoked will not
                # become valid by being asked again.
                with self._lock:
                    discarded = len(self._buffer)
                    self._buffer.clear()
                self._disabled = True
                self._stop_timer()
                self._report(
                    {"kind": "disabled", "status": response.status, "discarded": discarded, "detail": _detail(response)}
                )
                return
            self._report({"kind": "refused", "status": response.status, "detail": _detail(response)})
            return

        self._requeue(batch)
        retry_after = _retry_after_ms(response.headers)
        if retry_after is not None:
            # SDK-041: the server said when. Believe it.
            self._paused_until = self._clock() + retry_after
        else:
            self._schedule_backoff()

    def _schedule_backoff(self) -> None:
        """SDK-042: exponential, capped, full jitter.

        Without jitter every client that failed in one outage returns in the
        same millisecond and knocks the recovering server over again.
        """
        self._attempt += 1
        ceiling = min(BACKOFF["maxMs"], BACKOFF["baseMs"] * (BACKOFF["factor"] ** (self._attempt - 1)))
        self._paused_until = self._clock() + self._random() * ceiling

    def _requeue(self, batch: list[_Event]) -> None:
        """SDK-021: back to the head, so ordering survives."""
        with self._lock:
            self._buffer[0:0] = batch
            self._trim_locked()

    def _trim_locked(self) -> None:
        """SDK-020/022: bounded on insert, dropping the oldest."""
        excess = len(self._buffer) - self._max_buffer
        if excess <= 0:
            return
        del self._buffer[:excess]
        self._dropped += excess
        self._report({"kind": "dropped", "events": excess, "reason": "queue_full"})

    def _current_visit(self) -> str:
        """SDK-050: rolls over after inactivity. Never an identity."""
        now = self._clock()
        if self._visit_id is None or (
            self._visit_timeout_ms > 0 and now - self._visit_seen > self._visit_timeout_ms
        ):
            self._visit_id = _mint_visit(now, self._random)
        self._visit_seen = now
        return self._visit_id

    def _report_receipt(self, body: dict[str, Any] | None) -> None:
        if not body:
            return
        if body.get("rejected", 0):
            reasons = [o.get("reason") for o in body.get("outcomes", []) if not o.get("accepted")]
            self._report({"kind": "rejected", "events": body["rejected"], "reasons": reasons})
        quota = body.get("quota")
        if quota and quota.get("state") != "ok":
            self._report({"kind": "quota", **quota})

    def _report(self, diagnostic: dict[str, Any]) -> None:
        if self._on_diagnostic is not None:
            self._on_diagnostic(diagnostic)

    def _start_timer(self) -> None:
        if self._interval <= 0 or self._closed or self._disabled:
            return
        self._timer = threading.Timer(self._interval, self._on_tick)
        # So a script is not held open by analytics.
        self._timer.daemon = True
        self._timer.start()

    def _on_tick(self) -> None:
        self.flush()
        self._start_timer()

    def _stop_timer(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None


def _detail(response: Response) -> str:
    if response.body and isinstance(response.body.get("detail"), str):
        return response.body["detail"]
    return f"HTTP {response.status}"


def _retryable(response: Response) -> bool:
    """SDK-044: the server's own answer wins; the status list is the fallback."""
    if response.body is not None and isinstance(response.body.get("retryable"), bool):
        return bool(response.body["retryable"])
    return response.status in RETRYABLE_STATUSES


def _retry_after_ms(headers: dict[str, str]) -> float | None:
    raw = None
    for name, value in headers.items():
        if name.lower() == "retry-after":
            raw = value
            break
    if raw is None:
        return None
    try:
        return float(raw) * 1000
    except ValueError:
        return None


def _iso(millis: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(millis / 1000)) + f".{int(millis % 1000):03d}Z"


def _mint_visit(millis: float, random_source: Callable[[], float]) -> str:
    suffix = format(int(random_source() * (36**8)), "x")
    return f"{int(millis // 1000)}.{suffix}"
