#!/usr/bin/env python3
"""Classify sheet rows via worker liveness + capability (never Manual from capability alone)."""

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


def verify_row(token: str, row: dict) -> dict:
    payload = json.dumps(
        {
            "url": str(row.get("Job URL") or "").strip(),
            "role": str(row.get("Role") or "").strip(),
            "currentStatus": str(row.get("Status") or "").strip(),
            "notes": str(row.get("Notes") or "").strip(),
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{WORKER}/queue/verify",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify Job URL rows with posting verification")
    parser.add_argument("rows_json", type=Path, help="JSON array of sheet rows with Job URL + Status")
    args = parser.parse_args()
    rows = json.loads(args.rows_json.read_text(encoding="utf-8"))
    token = load_token()
    for row in rows:
        url = str(row.get("Job URL") or "").strip()
        if not url.startswith("http"):
            out = {
                "row_number": row.get("row_number"),
                "Company": row.get("Company"),
                "Job URL": url,
                "current_status": row.get("Status"),
                "recommended_status": "Review",
                "reason": "invalid_url",
            }
            print(json.dumps(out, ensure_ascii=False))
            continue
        try:
            payload = verify_row(token, row)
        except Exception as err:  # noqa: BLE001 — CLI tool reports per-row failures
            print(
                json.dumps(
                    {
                        "row_number": row.get("row_number"),
                        "Company": row.get("Company"),
                        "Job URL": url,
                        "current_status": row.get("Status"),
                        "recommended_status": "Review",
                        "reason": f"verify_failed:{err}",
                    },
                    ensure_ascii=False,
                )
            )
            continue
        rec = payload.get("recommendation")
        capability = payload.get("capability")
        out = {
            "row_number": row.get("row_number"),
            "Company": row.get("Company"),
            "Job URL": url,
            "current_status": row.get("Status"),
            "capability": capability,
            "recommended_status": (rec or {}).get("status") or payload.get("classifyOnly"),
            "reason": (rec or {}).get("reason"),
            "evidence": (rec or {}).get("evidence") or (payload.get("liveness") or {}).get("reason"),
        }
        print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
