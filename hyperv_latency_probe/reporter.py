"""Incremental latency reporter."""
import csv
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import config


class LatencyReporter:
    """Writes latency records incrementally to CSV."""

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = Path(path or config.REPORT_PATH)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fieldnames: List[str] = [
            "run_id",
            "cycle",
            "sequence",
            "label",
            "route_type",
            "endpoint",
            "host",
            "level",
            "refresh",
            "query",
            "http_status",
            "success",
            "latency_sec",
            "timeout_hit",
            "retry_count",
            "retry_reason",
            "token_refresh",
            "error_type",
            "error_message",
            "started_at",
            "finished_at",
        ]
        file_exists = self._prepare_target()
        self._file = self.path.open("a" if file_exists else "w", newline="", encoding="utf-8")
        self._writer = csv.DictWriter(self._file, fieldnames=self.fieldnames)
        if not file_exists:
            self._writer.writeheader()
            self._file.flush()
        self._sync()

    def record(self, entry: Dict[str, Any]) -> None:
        """Write a single record and flush immediately."""
        try:
            row = {field: entry.get(field, "") for field in self.fieldnames}
            for key, value in list(row.items()):
                if value is None:
                    row[key] = ""
            row["started_at"] = entry.get("started_at", datetime.now(timezone.utc).isoformat())
            row["finished_at"] = entry.get("finished_at", datetime.now(timezone.utc).isoformat())
            self._normalize_booleans(row, ["success", "timeout_hit", "token_refresh", "refresh"])
            latency_val = entry.get("latency_sec")
            row["latency_sec"] = "" if latency_val is None else latency_val
            retry_count_val = entry.get("retry_count", 0)
            row["retry_count"] = 0 if retry_count_val is None else retry_count_val
            row["retry_reason"] = entry.get("retry_reason", "") or ""
            row["error_message"] = self._sanitize_message(entry.get("error_message", ""))
            row["error_type"] = entry.get("error_type", "") or ""
            self._writer.writerow(row)
            self._file.flush()
            self._sync()
        except Exception as exc:
            # Avoid crashing the runner if disk/logging misbehaves.
            try:
                print(f"[reporter] failed to record entry: {exc}", flush=True)
            except Exception:
                pass

    def _sync(self) -> None:
        """Force data to disk for long-running safety."""
        try:
            os.fsync(self._file.fileno())
        except Exception:
            # Avoid crashing if fsync is not supported.
            pass

    def close(self) -> None:
        """Close the underlying file handle."""
        try:
            self._file.flush()
            self._sync()
            self._file.close()
        except Exception:
            pass

    def _prepare_target(self) -> bool:
        """Ensure the CSV header matches the expected schema."""
        if not self.path.exists() or self.path.stat().st_size == 0:
            return False
        try:
            with self.path.open("r", encoding="utf-8") as existing:
                header_line = existing.readline().strip()
        except Exception:
            header_line = ""
        current_header = header_line.split(",") if header_line else []
        if current_header == self.fieldnames:
            return True
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = self.path.with_suffix(self.path.suffix + f".bak-{timestamp}")
        try:
            self.path.rename(backup)
        except Exception:
            pass
        return False

    @staticmethod
    def _sanitize_message(message: Any) -> str:
        """Trim and clean up error messages for CSV safety."""
        if message is None:
            return ""
        text = str(message).replace("\n", " ").replace("\r", " ")
        if len(text) > config.ERROR_MESSAGE_MAX_LEN:
            return text[: config.ERROR_MESSAGE_MAX_LEN]
        return text

    @staticmethod
    def _normalize_booleans(row: Dict[str, Any], keys: List[str]) -> None:
        """Convert boolean-like values to lowercase strings."""
        for key in keys:
            value = row.get(key, "")
            if isinstance(value, bool):
                row[key] = str(value).lower()
            elif isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in {"true", "false"}:
                    row[key] = lowered
