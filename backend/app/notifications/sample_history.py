from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Dict, Iterable, List, Optional, Tuple

from app.notifications.utils import ensure_utc, norm_enum

MetricKey = Tuple[str, str, str]
MetricPoint = Tuple[datetime, float]

DEFAULT_WINDOW_SECONDS = 3600
DEFAULT_MIN_SAMPLES = 4
MAX_POINTS_PER_KEY = 64


class SampleHistory:
    def __init__(self, window_seconds: int = DEFAULT_WINDOW_SECONDS, min_samples: int = DEFAULT_MIN_SAMPLES) -> None:
        self.window_seconds = window_seconds
        self.min_samples = min_samples
        self._store: Dict[MetricKey, List[MetricPoint]] = {}
        self._lock = RLock()

    def _key(self, provider: str, vm_name: str, metric: str) -> MetricKey:
        return (norm_enum(provider), (vm_name or "").strip().lower(), norm_enum(metric))

    def reset(self) -> None:
        with self._lock:
            self._store.clear()

    def record_value(self, provider: str, vm_name: str, metric: str, at: datetime, value: float) -> None:
        if value is None:
            return
        key = self._key(provider, vm_name, metric)
        at_utc = ensure_utc(at)
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=self.window_seconds)
        with self._lock:
            points = self._store.setdefault(key, [])
            if points:
                last_at, last_value = points[-1]
                if last_at == at_utc and last_value == float(value):
                    return
            points.append((at_utc, float(value)))
            if len(points) > MAX_POINTS_PER_KEY:
                points[:] = points[-MAX_POINTS_PER_KEY:]
            points[:] = [(ts, val) for ts, val in points if ts >= cutoff]

    def record_samples(self, samples: Iterable[dict]) -> None:
        now = datetime.now(timezone.utc)
        for sample in samples:
            if not isinstance(sample, dict):
                continue
            provider = sample.get("provider")
            vm_name = sample.get("vm_name")
            at = sample.get("at") or now
            if not isinstance(at, datetime):
                at = now
            if not provider or not vm_name:
                continue
            cpu = sample.get("cpu_pct")
            ram = sample.get("ram_pct")
            if cpu is not None:
                self.record_value(provider, vm_name, "cpu", at, cpu)
            if ram is not None:
                self.record_value(provider, vm_name, "ram", at, ram)

    def get_recent_average(
        self,
        provider: str,
        vm_name: str,
        metric: str,
        *,
        now: Optional[datetime] = None,
    ) -> Tuple[Optional[float], Optional[datetime], int]:
        key = self._key(provider, vm_name, metric)
        now_utc = ensure_utc(now) if isinstance(now, datetime) else datetime.now(timezone.utc)
        cutoff = now_utc - timedelta(seconds=self.window_seconds)
        with self._lock:
            points = [entry for entry in self._store.get(key, []) if entry[0] >= cutoff]
        if len(points) < self.min_samples:
            return None, None, len(points)
        points.sort(key=lambda item: item[0])
        recent = points[-self.min_samples :]
        avg = sum(value for _, value in recent) / len(recent)
        return avg, recent[-1][0], len(points)


history = SampleHistory()
