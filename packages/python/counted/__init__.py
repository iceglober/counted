"""Counted — privacy-first product analytics.

Behaviour is specified in ``contract/sdk-behaviour.md`` and enforced by the
cross-language conformance suite.
"""

from .client import Counted, HttpTransport, Response, Transport
from .platform import SDK_VERSION, canonical_os, detect_system

__all__ = [
    "Counted",
    "HttpTransport",
    "Response",
    "Transport",
    "SDK_VERSION",
    "canonical_os",
    "detect_system",
]
