"""Text utilities for consistent comparisons across the application."""

from __future__ import annotations

import unicodedata


def normalize_text(value: str | None) -> str:
    """Return a lowercase, accent-free version of *value* for robust filtering."""
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return stripped.lower()
