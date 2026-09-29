#!/usr/bin/env python3
"""Pick one Review row from the job sheet and explain why apply failed. Read-only."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
N8N_ENV = Path("/opt/apps/n8n/.env")
APPLY_WF_ID = "fcYSvcG7IiP8xAqr"
CONTAINER = "job-application-agent"
TZ = ZoneInfo("Asia/Jerusalem")

BLOCKER_RE = re.compile(r"^blocker=(\S+)", re.M)
RESULT_RE = re.compile(r"^result=(\S+)", re.M)


@dataclass
class ReviewRow:
    row_number: int
    company: str
    role: str
    job_url: str
    status: str
    notes: str
    blocker: str
    source: str
    execution_id: int | None = None

    def as_dict(self) -> dict:
        return {
            "row_number": self.row_number,
            "company": self.company,
            "role": self.role,
            "job_url": self.job_url,
            "status": self.status,
            "blocker": self.blocker,
            "source": self.source,
            "execution_id": self.execution_id,
            "notes": self.notes,
        }


def load_n8n_api_key() -> str:
    if not N8N_ENV.is_file():
        return ""
    for line in N8N_ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("N8N_API_KEY="):
            return line.split("=", 1)[1].strip()
    return ""


def parse_blocker(notes: str) -> str:
    match = BLOCKER_RE.search(notes or "")
    return match.group(1) if match else ""


def row_from_sheet_json(item: dict, source: str, execution_id: int | None) -> ReviewRow | None:
    status = str(item.get("Status", "")).strip()
    if status.lower() != "review":
        return None
    notes = str(item.get("Notes", "") or "")
    try:
        row_number = int(item.get("row_number") or 0)
    except (TypeError, ValueError):
        return None
    if row_number <= 0:
        return None
    return ReviewRow(
        row_number=row_number,
        company=str(item.get("Company", "")),
        role=str(item.get("Role", "")),
        job_url=str(item.get("Job URL", "")).strip(),
        status=status,
        notes=notes,
        blocker=parse_blocker(notes),
        source=source,
        execution_id=execution_id,
    )


def fetch_latest_apply_execution(api: str, limit: int = 8) -> tuple[int, dict] | None:
    url = f"http://127.0.0.1:5678/api/v1/executions?workflowId={APPLY_WF_ID}&limit={limit}&status=success"
    req = urllib.request.Request(url, headers={"X-N8N-API-KEY": api})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None
    for ex in payload.get("data", []):
        eid = ex.get("id")
        if not eid:
            continue
        detail_url = f"http://127.0.0.1:5678/api/v1/executions/{eid}?includeData=true"
        req2 = urllib.request.Request(detail_url, headers={"X-N8N-API-KEY": api})
        try:
            with urllib.request.urlopen(req2, timeout=120) as resp2:
                detail = json.loads(resp2.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
            continue
        runs = detail.get("data", {}).get("resultData", {}).get("runData", {})
        if runs.get("Read Jobs"):
            return int(eid), runs
    return None


def collect_review_rows(runs: dict, execution_id: int) -> list[ReviewRow]:
    by_key: dict[tuple[int, str], ReviewRow] = {}

    read = runs.get("Read Jobs")
    if read:
        for item in read[0]["data"]["main"][0]:
            row = row_from_sheet_json(item["json"], "sheet_read", execution_id)
            if row:
                by_key[(row.row_number, row.job_url)] = row

    pick = runs.get("Pick Jobs")
    if pick:
        for item in pick[0]["data"]["main"][0]:
            j = item["json"]
            status = str(j.get("Status", "")).strip()
            notes = str(j.get("Notes", "") or "")
            if status.lower() != "review" and "blocker=" not in notes:
                continue
            row = row_from_sheet_json({**j, "Status": "Review"}, "pick_jobs", execution_id)
            if row:
                by_key[(row.row_number, row.job_url)] = row

    def sort_key(r: ReviewRow) -> tuple[int, int, int]:
        known = 1 if r.blocker and r.blocker != "unknown" else 0
        from_pick = 1 if r.source == "pick_jobs" else 0
        return (-known, -from_pick, -r.row_number)

    return sorted(by_key.values(), key=sort_key)


def pick_row(rows: list[ReviewRow], row_number: int | None, job_url: str | None) -> ReviewRow | None:
    if row_number is not None:
        for row in rows:
            if row.row_number == row_number:
                return row
        return None
    if job_url:
        needle = job_url.strip().lower()
        for row in rows:
            if needle in row.job_url.lower():
                return row
        return None
    for row in rows:
        if row.blocker:
            return row
    return rows[0] if rows else None


def worker_log_events(job_url: str, hours: int = 72) -> list[dict]:
    try:
        raw = subprocess.check_output(
            ["docker", "logs", CONTAINER, f"--since={hours}h"],
            text=True,
            timeout=60,
            stderr=subprocess.STDOUT,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return []
    host = ""
    try:
        host = job_url.split("/")[2].lower()
    except IndexError:
        host = job_url.lower()
    events: list[dict] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        if host and host not in line.lower():
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events[-40:]


def suggest_fix(blocker: str) -> str:
    hints = {
        "navigation_failed": "src/application/job-navigation-url.ts + openJob() in apply-job.ts; return review not HTTP 500.",
        "cv_upload_failed": "src/browser/form-filler.ts waitForResumeUploadTarget + Greenhouse iframe timing.",
        "missing_fact": "src/application/field-map.ts, facts.ts, or answer-question.ts for new question labels.",
        "form_not_detected": "revealApplyForm(), richestFormScope(), classify-page.ts.",
        "captcha": "Manual completion only; do not auto-submit.",
        "email_verification_required": "Greenhouse email OTP — finish in headed browser; check inbox for 8-character code.",
        "confirmation_not_detected": "verify-submission.ts + greenhouse.ts; may be OTP or thank-you copy.",
        "login_required": "Needs account flow or skip; document as not automatable.",
        "careers_page": "pick-opening.ts or fix job URL to a single posting.",
        "no_matching_opening": "pick-opening.ts / listing_match logic.",
        "form_validation": "form-filler.ts field types (phone, checkbox, select).",
        "cv_generation_failed": "src/cv/generate.ts + validate.ts truth gates.",
        "already_submitted": "Ledger hit; no code fix unless URL normalization wrong.",
    }
    return hints.get(blocker, "Inspect worker logs and apply-job.ts blocker path; add test if repeatable.")


def print_report(row: ReviewRow, events: list[dict], as_json: bool) -> None:
    interesting = [
        e for e in events
        if e.get("event") in {
            "REQUEST_FAILED",
            "JOB_NAVIGATION_FAILED",
            "NAVIGATION_RETRY",
            "REVIEW_REQUIRED",
            "VALIDATION_FAILED",
            "CV_UPLOAD_RETRY",
            "CV_UPLOADED",
            "JOB_OPENED",
            "CAPTCHA_REQUIRED",
        }
    ]
    repro_body = json.dumps(
        {
            "submit": False,
            "ignoreLedger": True,
            "row": row.row_number,
            "job": {"company": row.company, "role": row.role, "url": row.job_url},
        },
        ensure_ascii=False,
    )
    payload = {
        "selected": row.as_dict(),
        "fix_hint": suggest_fix(row.blocker),
        "worker_events": interesting[-15:],
        "repro_dry_run_body": repro_body,
    }
    if as_json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return
    now = datetime.now(TZ).strftime("%Y-%m-%d %H:%M %Z")
    print(f"# Review row triage — {now}\n")
    print("## Selected row")
    print(f"- **Row:** {row.row_number}")
    print(f"- **Company / role:** {row.company} — {row.role}")
    print(f"- **Job URL:** {row.job_url}")
    print(f"- **Blocker:** `{row.blocker or 'unknown'}` (from sheet notes, source={row.source})")
    if row.execution_id:
        print(f"- **n8n apply execution:** `{row.execution_id}`")
    print("\n## Sheet notes")
    print(row.notes.strip() or "_(empty)_")
    print("\n## Likely code area")
    print(suggest_fix(row.blocker))
    if interesting:
        print("\n## Worker log (filtered)")
        for ev in interesting[-10:]:
            ts = ev.get("ts", "")
            event = ev.get("event", "")
            extra = ev.get("message") or ev.get("question") or ev.get("label") or ev.get("url") or ""
            print(f"- `{ts}` **{event}** {str(extra)[:200]}")
    else:
        print("\n## Worker log")
        print("- No matching structured events in recent docker logs (job may not have been opened yet).")
    print("\n## Dry-run repro (agent: load token from .env, never print it)")
    body = json.dumps(
        {
            "submit": False,
            "ignoreLedger": True,
            "row": row.row_number,
            "job": {"company": row.company, "role": row.role, "url": row.job_url},
        },
        ensure_ascii=False,
    )
    print("```bash")
    print(f"TOKEN=$(grep '^APPLY_API_TOKEN=' {ENV_FILE} | cut -d= -f2-)")
    print("curl -s -X POST http://127.0.0.1:3099/apply \\")
    print('  -H "Authorization: Bearer $TOKEN" \\')
    print('  -H "Content-Type: application/json" \\')
    print(f"  -d '{body}'")
    print("```")


def main() -> int:
    parser = argparse.ArgumentParser(description="Triage one Review row from the job sheet.")
    parser.add_argument("--row", type=int, default=None, help="Sheet row_number to inspect")
    parser.add_argument("--url", type=str, default=None, help="Substring match on Job URL")
    parser.add_argument("--json", action="store_true", help="Machine-readable output")
    args = parser.parse_args()

    api = load_n8n_api_key()
    if not api:
        print("triage-review-row: missing N8N_API_KEY in /opt/apps/n8n/.env", file=sys.stderr)
        return 2
    fetched = fetch_latest_apply_execution(api)
    if not fetched:
        print("triage-review-row: could not load apply workflow execution from n8n", file=sys.stderr)
        return 2
    execution_id, runs = fetched
    rows = collect_review_rows(runs, execution_id)
    if not rows:
        print("triage-review-row: no Review rows in latest apply execution", file=sys.stderr)
        return 1
    selected = pick_row(rows, args.row, args.url)
    if not selected:
        print("triage-review-row: no matching Review row for filters", file=sys.stderr)
        return 1
    events = worker_log_events(selected.job_url)
    print_report(selected, events, args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
