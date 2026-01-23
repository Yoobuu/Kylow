from __future__ import annotations

import os
import sys

import requests


def main() -> int:
    base = (os.getenv("API_BASE") or "http://localhost:8000").rstrip("/")
    token = os.getenv("API_TOKEN")
    if not token:
        print("API_TOKEN is required (Bearer token).", file=sys.stderr)
        return 2

    url = f"{base}/api/admin/system/settings"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except requests.RequestException as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        return 1

    if resp.status_code != 200:
        body = (resp.text or "").strip()
        if len(body) > 300:
            body = body[:300] + "..."
        print(f"Unexpected status {resp.status_code}: {body}", file=sys.stderr)
        return 1

    print("OK: /api/admin/system/settings returned 200")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
