#!/usr/bin/env python3
"""Python SDK conformance driver. Run as a subprocess by the orchestrator:
   COUNTED_KEY=ck_... COUNTED_HOST=http://127.0.0.1:PORT python3 py-driver.py <scenario>
Each scenario inits the real `counted` SDK and exercises one behavior.
"""
import os
import sys
from pathlib import Path

# Make the local SDK importable without installing it.
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "packages" / "python"))

from counted import Analytics  # noqa: E402

scenario = sys.argv[1]
key = os.environ["COUNTED_KEY"]
host = os.environ["COUNTED_HOST"]

if scenario == "flush":
    a = Analytics(key, host=host, session_id="conf-sess", flush_interval=600)
    a.track("alpha", {"n": 1})
    a.track("beta", {"n": 2})
    a.flush()
    a.destroy()  # ensure the send completes before exit
elif scenario == "batch":
    a = Analytics(key, host=host, max_batch_size=3, flush_interval=600)
    a.track("e1")
    a.track("e2")
    a.track("e3")  # hits the cap -> auto flush
    a.destroy()
elif scenario == "exit":
    a = Analytics(key, host=host, flush_interval=600)
    a.track("onexit")
    # No flush()/destroy(): the atexit handler must flush.
else:
    raise SystemExit(f"unknown scenario: {scenario}")
