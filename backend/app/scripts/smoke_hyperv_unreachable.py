from __future__ import annotations

import os
import sys
from urllib.parse import urlencode

import requests


def _split_hosts(raw: str | None) -> list[str]:
    if not raw:
        return []
    items = []
    for part in raw.replace(";", ",").split(","):
        host = part.strip().lower()
        if host:
            items.append(host)
    return items


def main() -> int:
    base = (os.getenv("API_BASE") or "http://localhost:8000").rstrip("/")
    token = os.getenv("API_TOKEN")
    if not token:
        print("API_TOKEN is required (Bearer token).", file=sys.stderr)
        return 2

    hosts = _split_hosts(os.getenv("HYPERV_SMOKE_HOSTS"))
    if not hosts:
        hosts = ["unreachable.invalid"]

    params = {"hosts": ",".join(hosts), "level": "summary", "refresh": "true"}
    url = f"{base}/api/hyperv/vms/batch?{urlencode(params)}"
    headers = {"Authorization": f"Bearer {token}"}

    try:
        resp = requests.get(url, headers=headers, timeout=15)
    except requests.RequestException as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        return 1

    if resp.status_code != 200:
        body = (resp.text or "").strip()
        if len(body) > 300:
            body = body[:300] + "..."
        print(f"Unexpected status {resp.status_code}: {body}", file=sys.stderr)
        return 1

    payload = resp.json() if resp.content else {}
    hosts_payload = payload.get("hosts") if isinstance(payload, dict) else None
    if not isinstance(hosts_payload, list):
        print("Missing hosts payload in response", file=sys.stderr)
        return 1

    has_unreachable = any(h.get("status") == "unreachable" for h in hosts_payload if isinstance(h, dict))
    if not has_unreachable:
        print("No host marked as unreachable in response", file=sys.stderr)
        return 1

    print("OK: hyperv batch returned 200 with unreachable host status")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
