#!/usr/bin/env python3
"""Classify sheet rows via worker capability resolver (one-time backlog cleanup)."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
WORKER = "http://127.0.0.1:3099"


def load_token() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("APPLY_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("APPLY_API_TOKEN missing in .env")


def capability(token: str, url: str) -> str:
    query = urllib.parse.urlencode({"url": url})
    req = urllib.request.Request(
        f"{WORKER}/queue/capability?{query}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode())
    return str(payload.get("capability") or "invalid")


def recommend_status(cap: str) -> str:
    if cap == "invalid":
        return "Closed"
    if cap in {"manual_only", "resolvable"}:
        return "Manual"
    if cap == "supported_auto":
        return "New"
    return "Review"


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify Job URL rows for backlog cleanup")
    parser.add_argument("rows_json", type=Path, help="JSON array of sheet rows with Job URL + Status")
    args = parser.parse_args()
    rows = json.loads(args.rows_json.read_text(encoding="utf-8"))
    token = load_token()
    for row in rows:
        url = str(row.get("Job URL") or "").strip()
        cap = capability(token, url) if url.startswith("http") else "invalid"
        out = {
            "row_number": row.get("row_number"),
            "Company": row.get("Company"),
            "Job URL": url,
            "current_status": row.get("Status"),
            "capability": cap,
            "recommended_status": recommend_status(cap),
        }
        print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
