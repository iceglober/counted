"""Canonical platform detection.

SDK-070/071. The value sent is the closed enum the server stores — ``macos``,
not ``Darwin``. v1's four SDKs each sent their own spelling into one column, so
a breakdown by operating system showed macOS four times with the traffic split
between them.
"""

from __future__ import annotations

import locale
import platform as _platform
import sys
from typing import Any

from ._contract import OS_ALIASES, OS_NAMES

SDK_VERSION = "counted-python/2.0.0"

_SYSTEMS = {
    "darwin": "macos",
    "windows": "windows",
    "linux": "linux",
    "freebsd": "freebsd",
    "openbsd": "freebsd",
    "netbsd": "freebsd",
}


def canonical_os(raw: str | None) -> str:
    """Map anything to the closed set. Unrecognised becomes ``other``."""
    if not raw:
        return "other"
    stripped = "".join(c for c in raw.lower() if c.isalnum())
    mapped = OS_ALIASES.get(stripped)
    if mapped is not None:
        return mapped
    return _SYSTEMS.get(stripped, "other")


def detect_system(app_version: str | None = None) -> dict[str, Any]:
    system = canonical_os(_platform.system())
    if system == "other" and sys.platform.startswith("linux"):
        system = "linux"

    try:
        tag = locale.getdefaultlocale()[0]
    except Exception:
        tag = None

    return {
        "os_name": system,
        "os_version": _platform.release() or None,
        "locale": tag.replace("_", "-") if tag else None,
        "app_version": app_version,
        "device_model": None,
        "sdk_version": SDK_VERSION,
        # SDK-070: the raw value is preserved rather than discarded, so a
        # platform nobody has mapped yet is discoverable.
        "os_name_raw": _platform.system() or None,
    }


assert all(name in OS_NAMES for name in set(OS_ALIASES.values())), "alias maps outside the closed set"
