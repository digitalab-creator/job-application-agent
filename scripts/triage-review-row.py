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

# Keep in sync with src/application/classify-page.ts (NOT_FOUND / CLOSED hero rules).
NOT_FOUND_RE = re.compile(r"\b404\b|page not found|job not found", re.I)
CLOSED_RE = re.compile(
    r"no longer (available|accepting)|position (has been |is )?closed|"
    r"this job has expired|no longer accepting applications|position has been filled|"
    r"job (is )?not available|we're sorry, but there are currently no open positions",
    re.I,
)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")

NON_CODE_FIXABLE = frozenset({"captcha", "login_required", "already_submitted", "dry_run"})
CODE_FIXABLE = frozenset({
    "navigation_failed",
    "cv_upload_failed",
    "form_validation",
    "missing_fact",
    "form_not_detected",
    "careers_page",
    "no_matching_opening",
    "email_verification_required",
    "submit_not_accepted",
    "cv_generation_failed",
    "confirmation_not_detected",
    "unknown",
})
LIVE_DEAD = frozenset({"NOT_FOUND", "CLOSED"})

_PROBE_CACHE: dict[str, tuple[str | None, str]] = {}


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


def html_to_text(html: str, limit: int = 15_000) -> str:
    text = TAG_RE.sub(" ", html)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def role_mentioned(role: str, text: str) -> bool:
    words = [w for w in re.split(r"[^a-z0-9]+", role.lower()) if len(w) > 3]
    if not words:
        return False
    haystack = text.lower()
    hits = sum(1 for word in words if word in haystack)
    return hits >= (len(words) + 1) // 2


def quick_live_job_status(url: str, role: str, timeout: int = 22) -> tuple[str | None, str]:
    """HTTP probe for dead links only. None = alive (includes careers/listing pages)."""
    if not url.lower().startswith("http"):
        return None, "not_http"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; job-application-agent-triage/1.0)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = int(getattr(resp, "status", 200) or 200)
            final_url = resp.geturl()
            raw = resp.read(280_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        status = err.code
        final_url = err.geturl()
        raw = err.read(160_000).decode("utf-8", "replace") if err.fp else ""
        if status == 404:
            return "NOT_FOUND", "http_404"
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        return None, f"probe_failed:{type(err).__name__}"

    if status == 404:
        return "NOT_FOUND", "http_404"

    title_match = TITLE_RE.search(raw)
    title = html_to_text(title_match.group(1), 500) if title_match else ""
    text = html_to_text(raw)
    hero = f"{title}\n{text[:1800]}"

    if NOT_FOUND_RE.search(title) or (NOT_FOUND_RE.search(hero) and not role_mentioned(role, hero)):
        return "NOT_FOUND", "hero_404"

    blob = f"{title}\n{text}"
    if CLOSED_RE.search(blob):
        return "CLOSED", "posting_closed"

    return None, final_url[:160]


def cached_live_probe(row: ReviewRow, enabled: bool) -> tuple[str | None, str]:
    if not enabled or not row.job_url.strip():
        return None, "live_check_disabled"
    key = row.job_url.strip()
    if key not in _PROBE_CACHE:
        _PROBE_CACHE[key] = quick_live_job_status(key, row.role)
    return _PROBE_CACHE[key]


def worker_log_events(job_url: str, company: str = "", hours: int = 72) -> list[dict]:
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
    company_key = company.strip().lower()
    events: list[dict] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        line_lower = line.lower()
        if host and host not in line_lower:
            if '"event":"CAPTCHA_REQUIRED"' in line and company_key:
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ev_company = str(payload.get("company", "")).strip().lower()
                if not (ev_company == company_key or company_key in ev_company or ev_company in company_key):
                    continue
            else:
                continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events[-40:]


def infer_blocker_from_logs(row: ReviewRow, events: list[dict]) -> str | None:
    company = row.company.strip().lower()
    for ev in reversed(events):
        event = ev.get("event", "")
        if event == "CAPTCHA_REQUIRED":
            ev_company = str(ev.get("company", "")).strip().lower()
            if company and (ev_company == company or company in ev_company or ev_company in company):
                return "captcha"
        if event == "CV_UPLOADED":
            return None
        if event in {"VALIDATION_FAILED", "REVIEW_REQUIRED"}:
            return "form_validation"
    return None


def effective_blocker(row: ReviewRow, events: list[dict]) -> str:
    inferred = infer_blocker_from_logs(row, events)
    if inferred:
        return inferred
    return row.blocker or "unknown"


def is_code_fixable(blocker: str) -> bool:
    key = (blocker or "unknown").strip()
    if key in NON_CODE_FIXABLE:
        return False
    if key in CODE_FIXABLE:
        return True
    return key not in NON_CODE_FIXABLE


def blocker_rank(blocker: str) -> int:
    priority = {
        "cv_upload_failed": 0,
        "navigation_failed": 1,
        "form_not_detected": 2,
        "missing_fact": 3,
        "form_validation": 4,
        "submit_not_accepted": 5,
        "email_verification_required": 6,
        "cv_generation_failed": 7,
        "confirmation_not_detected": 8,
        "careers_page": 9,
        "no_matching_opening": 10,
        "unknown": 11,
    }
    return priority.get(blocker, 12)


def pick_row(
    rows: list[ReviewRow],
    row_number: int | None,
    job_url: str | None,
    *,
    code_fixable_only: bool,
    live_check: bool,
) -> ReviewRow | None:
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

    pre_candidates: list[tuple[ReviewRow, str]] = []
    for row in rows:
        events = worker_log_events(row.job_url, row.company)
        blocker = effective_blocker(row, events)
        if code_fixable_only and not is_code_fixable(blocker):
            continue
        pre_candidates.append((row, blocker))

    pre_candidates.sort(key=lambda item: (blocker_rank(item[1]), -item[0].row_number))
    for row, _blocker in pre_candidates:
        live_status, _live_detail = cached_live_probe(row, live_check)
        if code_fixable_only and live_status in LIVE_DEAD:
            continue
        return row
    return None


def suggest_fix(blocker: str) -> str:
    hints = {
        "navigation_failed": "src/application/job-navigation-url.ts + openJob() in apply-job.ts; return review not HTTP 500.",
        "cv_upload_failed": "src/browser/form-filler.ts waitForResumeUploadTarget + Greenhouse iframe timing.",
        "missing_fact": "src/application/field-map.ts, facts.ts, or answer-question.ts for new question labels.",
        "form_not_detected": "revealApplyForm(), richestFormScope(), classify-page.ts.",
        "captcha": "No bypass. Status Manual (manual_required); human browser only.",
        "email_verification_required": "Greenhouse email OTP — finish in headed browser; check inbox for 8-character code.",
        "confirmation_not_detected": "verify-submission.ts + greenhouse.ts; may be OTP or thank-you copy.",
        "login_required": "No account flow in v1. Status Manual (manual_required).",
        "careers_page": "pick-opening.ts — worker should pick best listing match, not skip as dead URL.",
        "no_matching_opening": "pick-opening.ts / listing_match logic.",
        "form_validation": "form-filler.ts field types (phone, checkbox, select).",
        "cv_generation_failed": "src/cv/generate.ts + validate.ts truth gates.",
        "already_submitted": "Ledger hit; no code fix unless URL normalization wrong.",
        "NOT_FOUND": "Dead sheet URL (404). Set sheet Status Closed; fix discover URL — not worker code.",
        "CLOSED": "Posting removed on site. Set sheet Status Closed — not worker code.",
    }
    return hints.get(blocker, "Inspect worker logs and apply-job.ts blocker path; add test if repeatable.")


def print_report(
    row: ReviewRow,
    events: list[dict],
    as_json: bool,
    *,
    live_status: str | None,
    live_detail: str,
) -> None:
    eff = effective_blocker(row, events)
    log_blocker = infer_blocker_from_logs(row, events)
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
        "effective_blocker": eff,
        "sheet_blocker": row.blocker,
        "log_blocker": log_blocker,
        "code_fixable": is_code_fixable(eff),
        "live_probe_status": live_status,
        "live_probe_detail": live_detail,
        "fix_hint": suggest_fix(eff if live_status not in LIVE_DEAD else live_status),
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
    print(f"- **Code-fixable:** {'yes' if is_code_fixable(eff) and live_status not in LIVE_DEAD else 'no'}")
    if live_status in LIVE_DEAD:
        print(f"- **Live URL:** `{live_status}` ({live_detail}) — sheet should be **Closed**, not a code-fix target")
    elif live_status is None and live_detail not in ("live_check_disabled",):
        print(f"- **Live URL:** looks alive ({live_detail[:120]})")
    print(f"- **Blocker:** `{eff or 'unknown'}`", end="")
    if log_blocker and log_blocker != row.blocker:
        print(f" (worker log; sheet notes still say `{row.blocker}`)", end="")
    else:
        print(f" (from sheet notes, source={row.source})", end="")
    print()
    if row.execution_id:
        print(f"- **n8n apply execution:** `{row.execution_id}`")
    print("\n## Sheet notes")
    print(row.notes.strip() or "_(empty)_")
    print("\n## Likely code area")
    print(suggest_fix(eff if live_status not in LIVE_DEAD else live_status))
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
    parser.add_argument(
        "--code-fixable-only",
        action="store_true",
        help="Pick the first Review row worth a code fix (default when no --row/--url)",
    )
    parser.add_argument(
        "--include-non-fixable",
        action="store_true",
        help="Allow captcha/login/already_submitted rows when picking",
    )
    parser.add_argument(
        "--no-live-check",
        action="store_true",
        help="Do not HTTP-probe Job URLs for 404/closed (faster, less accurate)",
    )
    args = parser.parse_args()
    code_fixable_only = args.code_fixable_only or (
        args.row is None and args.url is None and not args.include_non_fixable
    )
    live_check = not args.no_live_check

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
    selected = pick_row(
        rows,
        args.row,
        args.url,
        code_fixable_only=code_fixable_only,
        live_check=live_check,
    )
    if not selected:
        if code_fixable_only:
            print(
                "triage-review-row: no code-fixable Review rows after filters "
                "(skipped captcha/login, dead 404/closed URLs, already_submitted)",
                file=sys.stderr,
            )
        else:
            print("triage-review-row: no matching Review row for filters", file=sys.stderr)
        return 1
    live_status, live_detail = cached_live_probe(selected, live_check)
    events = worker_log_events(selected.job_url, selected.company)
    print_report(selected, events, args.json, live_status=live_status, live_detail=live_detail)
    return 0


if __name__ == "__main__":
    sys.exit(main())
