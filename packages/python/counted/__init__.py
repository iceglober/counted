"""Counted — Privacy-first analytics SDK for Python."""

from counted.client import Analytics
from counted.client import track, flush, destroy, init

__all__ = ["Analytics", "track", "flush", "destroy", "init"]
__version__ = "0.1.0"
