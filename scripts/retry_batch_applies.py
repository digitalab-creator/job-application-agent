#!/usr/bin/env python3
"""Retry a JSON job list against POST /apply — one batch at a time (flock + server 409)."""

from __future__ import annotations

import argparse
import fcntl
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = ROOT / "data/ledger/retry-batch.lock"
ENV_FILE = ROOT / ".env"
APPLY_URL = "http://127.0.0.1:3099/apply"
WAIT_BUSY_SECS = 900
POLL_SECS = 15


def load_token() -> str:
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("APPLY_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("APPLY_API_TOKEN missing in .env")


def post_apply(token: str, job: dict, *, submit: bool, ignore_ledger: bool) -> tuple[int, dict]:
    payload = {
        "submit": submit,
        "ignoreLedger": ignore_ledger,
        "job": {
            "company": job["company"],
            "role": job["role"],
            "url": job["url"],
        },
    }
    req = urllib.request.Request(
        APPLY_URL,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=WAIT_BUSY_SECS) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else "{}"
        try:
            parsed = json.loads(body) if body.strip() else {}
        except json.JSONDecodeError:
            parsed = {"notes": body[:200]}
        return e.code, parsed


def main() -> int:
    parser = argparse.ArgumentParser(description="Sequential batch retry with global flock")
    parser.add_argument("jobs_json", type=Path, help="JSON array of {company, role, url}")
    parser.add_argument("--submit", action="store_true", help="Real submit (default dry-run fill only)")
    parser.add_argument("--ignore-ledger", action="store_true", default=True)
    parser.add_argument("--lock-file", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--out", type=Path, default=Path("/tmp/retry-batch-results.jsonl"))
    args = parser.parse_args()

    jobs = json.loads(args.jobs_json.read_text(encoding="utf-8"))
    if not isinstance(jobs, list) or not jobs:
        raise SystemExit("jobs_json must be a non-empty JSON array")

    args.lock_file.parent.mkdir(parents=True, exist_ok=True)
    token = load_token()
    results: list[dict] = []

    with args.lock_file.open("w") as lock_fp:
        try:
            fcntl.flock(lock_fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(
                f"Another retry batch is already running (lock: {args.lock_file}). Stop it first.",
                file=sys.stderr,
            )
            return 2

        print(f"retry_batch: {len(jobs)} jobs submit={args.submit}", flush=True)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text("", encoding="utf-8")
        for i, job in enumerate(jobs, 1):
            company = str(job.get("company") or "?")
            role = str(job.get("role") or "?")
            url = str(job.get("url") or "").strip()
            if not url.startswith("http"):
                print(f"[{i}/{len(jobs)}] SKIP {company} — bad url", flush=True)
                continue

            deadline = time.time() + WAIT_BUSY_SECS
            while True:
                print(f"[{i}/{len(jobs)}] START {company}", flush=True)
                t0 = time.time()
                code, body = post_apply(token, job, submit=args.submit, ignore_ledger=args.ignore_ledger)
                if code == 409:
                    print(f"[{i}/{len(jobs)}] worker busy — waiting {POLL_SECS}s", flush=True)
                    if time.time() >= deadline:
                        body = {"status": "failed", "blocker": "apply_in_progress", "notes": "Timed out waiting for worker"}
                        code = 408
                        break
                    time.sleep(POLL_SECS)
                    continue
                break

            row = {
                "company": company,
                "role": role,
                "url": url,
                "httpStatus": code,
                "status": body.get("status"),
                "confirmationDetected": bool(body.get("confirmationDetected")),
                "blocker": body.get("blocker"),
                "elapsed_s": int(time.time() - t0),
            }
            results.append(row)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            with args.out.open("a", encoding="utf-8") as out_fp:
                out_fp.write(json.dumps(row) + "\n")
            print(
                f"[{i}/{len(jobs)}] DONE confirmed={row['confirmationDetected']} "
                f"blocker={row.get('blocker')} {row['elapsed_s']}s",
                flush=True,
            )

        confirmed = sum(1 for r in results if r.get("confirmationDetected"))
        print(f"CONFIRMED {confirmed}/{len(results)}", flush=True)
        fcntl.flock(lock_fp.fileno(), fcntl.LOCK_UN)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
