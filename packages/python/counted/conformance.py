"""The conformance driver.

Speaks the line protocol on stdin/stdout. Every assertion, every scenario and
every comparison lives in the runner — this only translates commands into SDK
calls and reports what its fake transport saw. Four scenario interpreters could
each be subtly wrong, which is the failure the suite exists to prevent.

The one subtle part is the same in every language, and it is worth stating
because getting it wrong makes scenarios fail for reasons that are not the
SDK's fault. A scenario reads::

    {"do": "flush"}
    {"expect": "request", "events": ["a"]}
    {"respond": {"status": 429}}

The response is declared *after* the request is asserted, because that is how
it reads. So a send has to **park** while the driver keeps reading stdin, or
the ``respond`` arrives too late and applies to the next request instead. That
means the flush runs on a worker thread and the transport blocks on a queue the
main loop feeds — which is also how a real SDK behaves, so it is not a
contrivance for the tests.
"""

from __future__ import annotations

import json
import queue
import sys
import threading
import time
from typing import Any

from .client import Counted, Response


class ScriptedTransport:
    """A fake network the runner drives, one answer at a time."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.requests: list[dict[str, Any]] = []
        self.answers: queue.Queue[dict[str, Any]] = queue.Queue()
        self.arrived = threading.Event()

    def send(self, url: str, key: str, body: str) -> Response:
        with self.lock:
            self.requests.append(
                {"url": url, "headers": {"authorization": f"Bearer {key}"}, "body": json.loads(body)}
            )
        self.arrived.set()

        try:
            # Parks here. The main loop is still reading stdin, so a `respond`
            # can arrive and release it.
            answer = self.answers.get(timeout=2.0)
        except queue.Empty:
            # No scenario answer: accept, which is what an unscripted request
            # deserves.
            return Response(202, {}, {"accepted": 1, "deduplicated": 0, "rejected": 0})

        if answer.get("networkError"):
            raise OSError("connection reset")
        return Response(answer["status"], answer.get("headers") or {}, answer.get("body"))


def main() -> None:
    clock = {"now": 1_773_759_600_000.0}  # 2026-03-17T15:00:00Z
    transport = ScriptedTransport()
    counted = Counted(
        key="ck_conformance",
        endpoint="https://api.test/v1/events",
        # Driven explicitly; a real timer would race the virtual clock.
        flush_interval_ms=0,
        transport=transport,
        clock=lambda: clock["now"],
        # Deterministic, so a jittered backoff is still assertable.
        random_source=lambda: 0.5,
    )

    workers: list[threading.Thread] = []

    def run_async(work: Any) -> None:
        thread = threading.Thread(target=work, daemon=True)
        thread.start()
        workers.append(thread)
        # Give it a moment to reach the transport, so a following `expect`
        # sees the request without the runner having to guess.
        transport.arrived.wait(0.05)
        transport.arrived.clear()

    def settle() -> None:
        """Let started work reach its next blocking point. Never joins.

        A worker parked on an unanswered request cannot finish, and joining it
        would time the park out and default-accept the very request the
        scenario is about to answer. That mistake cost three scenarios and none
        of them was an SDK fault.
        """
        time.sleep(0.02)
        workers[:] = [t for t in workers if t.is_alive()]

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        message = json.loads(line)
        command = message.get("cmd")
        reply: dict[str, Any] = {"ok": True}

        if command == "track":
            counted.track(message["name"], message.get("properties"))
        elif command == "identify":
            counted.identify(message["userId"])
        elif command == "reset":
            counted.reset()
        elif command == "flush":
            run_async(counted.flush)
        elif command == "shutdown":
            run_async(counted.shutdown)
        elif command == "advance":
            clock["now"] += message["ms"]
            # How a real timer would have driven it.
            run_async(counted.flush)
        elif command == "respond":
            transport.answers.put(message)
            # Let the parked worker take it and act on it — requeue, pause or
            # settle — before the next step asks what the state is.
            settle()
        elif command == "settle":
            settle()
        elif command == "drain":
            with transport.lock:
                reply = {"ok": True, "requests": transport.requests}
                transport.requests = []

        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
