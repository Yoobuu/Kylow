from __future__ import annotations

import threading

_lock = threading.Lock()
_is_restarting = False


def set_restarting(value: bool) -> None:
    global _is_restarting
    with _lock:
        _is_restarting = value


def is_restarting() -> bool:
    with _lock:
        return _is_restarting
