#!/usr/bin/env python3
"""Daily apply pipeline report (worker + logs + n8n). Read-only."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from n8n_orchestration import n8n_env_file  # noqa: E402

ENV_FILE = ROOT / ".env"
LEDGER = ROOT / "data/ledger/applications.jsonl"
ATTEMPTS_LEDGER = ROOT / "data/ledger/apply-attempts.jsonl"
QUOTA_LEDGER = ROOT / "data/ledger/daily-quota.jsonl"
NATIVE_RUN_LOG = ROOT / "data/ledger/native-runs.jsonl"
HEALTH_URL = "http://127.0.0.1:3099/health"
WORKER_BASE = "http://127.0.0.1:3099"
CONTAINER = "job-application-agent"
APPLY_WF_ID = "fcYSvcG7IiP8xAqr"
DISCOVER_WF_ID = "oreaKVjt7ifi0i6a"
TZ = ZoneInfo("Asia/Jerusalem")
DISCOVER_SKIP_NEW_MULTIPLIER = 3

BLOCKER_WHY: dict[str, str] = {
    "captcha": "Bot check on the careers site — worker stops; apply manually in a normal browser.",
    "login_required": "Site requires an account login; not automated in v1.",
    "navigation_failed": "Could not open the job URL or apply form.",
    "cv_upload_failed": "Resume upload field not found or upload timed out.",
    "missing_fact": "Screening question needs a fact not in the profile.",
    "form_not_detected": "Apply form never appeared on the page.",
    "email_verification_required": "Greenhouse email OTP — finish in browser.",
    "confirmation_not_detected": "Submit may have happened but thank-you page not detected.",
    "form_validation": "Form rejected answers (phone, checkbox, etc.).",
    "cv_generation_failed": "LLM/truth gate failed before apply.",
    "already_submitted": "Duplicate URL — already in ledger.",
    "careers_page": "Landed on generic careers hub, not a single job.",
    "no_matching_opening": "Multiple listings; worker could not pick a match.",
    "no_suitable_replacement": "Original opening was missing and no independently good replacement passed the fit gate.",
    "full_job_fit_failed": "Complete job description failed the candidate-fit gate.",
    "invalid_url": "URL was malformed or not HTTP(S); browser was not called.",
    "quota_reached": "Confirmed quota or safety attempt cap was reached.",
    "budget_reached": "Monthly LLM budget was exhausted before this opening.",
    "dry_run": "Intentional preview (`submit: false`) — not a failed apply.",
}

COMEET_SIZE_ERROR = re.compile(r"reading 'size'", re.I)
N8N_ENV = n8n_env_file()


def orchestration_mode() -> str:
    if not ENV_FILE.is_file():
        return "n8n"
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "ORCHESTRATION_MODE":
            return value.strip().lower() or "n8n"
    return "n8n"


def native_runs_today(day: str) -> list[dict]:
    return [
        row
        for row in read_jsonl(NATIVE_RUN_LOG)
        if row_on_day(str(row.get("startedAt", "")), day)
    ]


# Mirror runtime worker config: Google Sheet "Exclude Companies" synced via n8n.
APPLY_EXCLUDED_COMPANIES: tuple[str, ...] = ()


def is_automatable_apply_url(url: str) -> bool:
    """Same gate as n8n Pick Jobs: any real http(s) job link except known junk."""
    u = str(url or "").strip()
    if not re.match(r"^https?://", u, re.I):
        return False
    if "/jobs/stampli/" in u.lower() and "0b.273" in u.lower():
        return False
    if re.match(r"^https://apply\.workable\.com/comeet/", u, re.I):
        return False
    return True


def normalize_company_key(value: str) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[\s_\-./]+", "", text)
    return re.sub(r"[^\w]+", "", text, flags=re.UNICODE)


def load_excluded_companies() -> tuple[str, ...]:
    global APPLY_EXCLUDED_COMPANIES
    if APPLY_EXCLUDED_COMPANIES:
        return APPLY_EXCLUDED_COMPANIES
    token = load_token()
    if token:
        payload = http_json(f"{WORKER_BASE}/config/excluded-companies", token)
        if payload and isinstance(payload.get("companies"), list):
            APPLY_EXCLUDED_COMPANIES = tuple(
                str(item).strip() for item in payload["companies"] if str(item).strip()
            )
            return APPLY_EXCLUDED_COMPANIES
    # Fallback seed if worker is down — keep report usable.
    APPLY_EXCLUDED_COMPANIES = ("בורודה קפלן", "k-logic", "two-solutions")
    return APPLY_EXCLUDED_COMPANIES


def is_excluded_apply_company(company: str) -> bool:
    key = normalize_company_key(company)
    if not key:
        return False
    for excluded in load_excluded_companies():
        needle = normalize_company_key(excluded)
        if needle and (key == needle or needle in key):
            return True
    return False


def load_n8n_api_key() -> str:
    if not N8N_ENV.is_file():
        return ""
    for line in N8N_ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("N8N_API_KEY="):
            return line.split("=", 1)[1].strip()
    return ""


def sheet_queue_snapshot() -> dict[str, int] | None:
    """Best-effort: Read Jobs rows from today's latest apply execution."""
    api = load_n8n_api_key()
    if not api:
        return None
    day = jerusalem_today()
    try:
        url = (
            f"http://127.0.0.1:5678/api/v1/executions"
            f"?workflowId={APPLY_WF_ID}&limit=5&status=success"
        )
        req = urllib.request.Request(url, headers={"X-N8N-API-KEY": api})
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None
    for ex in payload.get("data", []):
        started = str(ex.get("startedAt", ""))
        if not started.startswith(day):
            continue
        eid = ex.get("id")
        if not eid:
            continue
        try:
            detail_url = f"http://127.0.0.1:5678/api/v1/executions/{eid}?includeData=true"
            req2 = urllib.request.Request(detail_url, headers={"X-N8N-API-KEY": api})
            with urllib.request.urlopen(req2, timeout=120) as resp2:
                detail = json.loads(resp2.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
            continue
        runs = detail.get("data", {}).get("resultData", {}).get("runData", {})
        read = runs.get("Read Jobs")
        pick = runs.get("Pick Jobs")
        if not read:
            continue
        rows = [item["json"] for item in read[0]["data"]["main"][0]]
        new_rows = [r for r in rows if str(r.get("Status", "")).strip() == "New"]
        automatable = [
            r
            for r in new_rows
            if is_automatable_apply_url(str(r.get("Job URL", "")))
            and not is_excluded_apply_company(str(r.get("Company", "")))
        ]
        picked = 0
        if pick:
            picked = len(pick[0].get("data", {}).get("main", [[]])[0])
        return {
            "execution_id": int(eid),
            "sheet_rows": len(rows),
            "status_new": len(new_rows),
            "automatable_new": len(automatable),
            "pick_jobs_output": picked,
        }
    return None


def jerusalem_today() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def load_token() -> str:
    if not ENV_FILE.is_file():
        return ""
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("APPLY_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    return ""


def http_json(url: str, token: str = "") -> dict | None:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None


def docker_logs_today(day: str) -> list[str]:
    try:
        raw = subprocess.check_output(
            ["docker", "logs", CONTAINER, "--since", f"{day}T00:00:00"],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=120,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return []
    lines = []
    for line in raw.splitlines():
        if f'"ts":"{day}' in line or f'"at":"{day}' in line:
            lines.append(line)
    return lines


def parse_log_events(lines: list[str]) -> list[dict]:
    events: list[dict] = []
    for line in lines:
        idx = line.find("{")
        if idx < 0:
            continue
        try:
            events.append(json.loads(line[idx:]))
        except json.JSONDecodeError:
            continue
    return events


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def row_on_day(at: str, day: str) -> bool:
    if not at:
        return False
    if str(at).startswith(day):
        return True
    try:
        dt = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
        return dt.astimezone(TZ).strftime("%Y-%m-%d") == day
    except ValueError:
        return False


def confirmed_today(day: str) -> list[dict]:
    out: list[dict] = []
    for row in attempts_today(day):
        if row.get("outcome") != "applied" and not row.get("confirmationDetected"):
            continue
        out.append(row)
    return out


def attempts_today(day: str) -> list[dict]:
    source = read_jsonl(ATTEMPTS_LEDGER)
    if source:
        out = [
            row for row in source
            if row_on_day(str(row.get("finishedAt", "")), day)
        ]
        out.sort(key=lambda r: str(r.get("finishedAt", "")))
        return out
    # Keep historical reports useful before the attempt ledger was deployed.
    out = [row for row in read_jsonl(LEDGER) if row_on_day(str(row.get("at", "")), day)]
    out.sort(key=lambda r: str(r.get("at", "")))
    return out


def attempt_outcome_label(row: dict) -> str:
    if row.get("outcome") == "applied" or row.get("confirmationDetected"):
        return "confirmed"
    blocker = str(row.get("outcome") or row.get("blocker") or "").strip()
    if blocker:
        return blocker
    return "no_confirmation"


def failure_reason(row: dict) -> str:
    if row.get("confirmationDetected"):
        return "Submission confirmed on site."
    label = attempt_outcome_label(row)
    if label in BLOCKER_WHY:
        return BLOCKER_WHY[label]
    if label == "no_confirmation":
        return "Worker finished without confirmation signal (check logs / sheet Notes)."
    return f"Blocker `{label}` — see sheet Notes or worker logs."


def cv_paths_from_attempts(attempts: list[dict]) -> set[str]:
    names: set[str] = set()
    for row in attempts:
        cv_path = str(row.get("cvPath") or "")
        if cv_path:
            names.add(cv_path.split("/")[-1])
    return names


def quota_rows_today(day: str) -> list[dict]:
    return [r for r in read_jsonl(QUOTA_LEDGER) if str(r.get("day", "")) == day]


def count_generated_cvs(day: str) -> int:
    d = ROOT / "generated-cv" / day
    if not d.is_dir():
        return 0
    return sum(1 for p in d.iterdir() if p.suffix.lower() == ".pdf")


@dataclass
class N8nRun:
    execution_id: int
    workflow_id: str
    status: str
    started: str
    stopped: str


def n8n_runs_today(day: str) -> list[N8nRun]:
    sql = (
        'SELECT e.id, e."workflowId", e.status, e."startedAt", e."stoppedAt" '
        'FROM execution_entity e '
        f"WHERE e.\"startedAt\" >= '{day}'::date "
        f"AND e.\"workflowId\" IN ('{APPLY_WF_ID}', '{DISCOVER_WF_ID}') "
        'ORDER BY e."startedAt";'
    )
    try:
        raw = subprocess.check_output(
            [
                "docker",
                "exec",
                "n8n-postgres",
                "psql",
                "-U",
                "n8n",
                "-d",
                "n8n",
                "-t",
                "-A",
                "-F",
                "\t",
                "-c",
                sql,
            ],
            text=True,
            timeout=30,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return []
    runs: list[N8nRun] = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        try:
            runs.append(
                N8nRun(
                    execution_id=int(parts[0]),
                    workflow_id=parts[1],
                    status=parts[2],
                    started=parts[3],
                    stopped=parts[4],
                )
            )
        except ValueError:
            continue
    return runs


def discover_execution_state(execution_id: int) -> str:
    """Return whether a Discover execution scanned boards, skipped, or is unknown."""
    api = load_n8n_api_key()
    if not api:
        return "unknown"
    url = f"http://127.0.0.1:5678/api/v1/executions/{execution_id}?includeData=true"
    request = urllib.request.Request(url, headers={"X-N8N-API-KEY": api})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return "unknown"

    run_data = payload.get("data", {}).get("resultData", {}).get("runData")
    if not isinstance(run_data, dict):
        return "unknown"

    scan_runs = run_data.get("Scan Boards")
    if isinstance(scan_runs, list) and scan_runs:
        for run in scan_runs:
            for item in node_output_items(run):
                result = item.get("json")
                if not isinstance(result, dict):
                    continue
                notes = str(result.get("notes", ""))
                if result.get("status") == "skipped" and "queue_depth" in notes:
                    return "skipped"
        return "scanned"

    if "Queue depth gate" in run_data:
        return "skipped"
    return "unknown"


def node_output_items(run: object) -> list[dict]:
    if not isinstance(run, dict):
        return []
    data = run.get("data")
    if not isinstance(data, dict):
        return []
    outputs = data.get("main")
    if not isinstance(outputs, list):
        return []
    items: list[dict] = []
    for output in outputs:
        if not isinstance(output, list):
            continue
        items.extend(item for item in output if isinstance(item, dict))
    return items


def container_running() -> bool:
    try:
        out = subprocess.check_output(
            ["docker", "ps", "--filter", f"name={CONTAINER}", "--format", "{{.Status}}"],
            text=True,
            timeout=10,
        ).strip()
        return out.startswith("Up")
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


def top_failure_messages(events: list[dict], limit: int = 3) -> list[tuple[str, int]]:
    msgs: list[str] = []
    for ev in events:
        if ev.get("event") != "REQUEST_FAILED":
            continue
        msg = str(ev.get("message", ""))
        if "careers.js" in msg and COMEET_SIZE_ERROR.search(msg):
            msgs.append("Comeet careers.js file-input crash (reading 'size')")
        elif msg:
            first = msg.split("\n", 1)[0][:120]
            msgs.append(first)
    return Counter(msgs).most_common(limit)


def review_questions(events: list[dict]) -> list[str]:
    out: list[str] = []
    for ev in events:
        if ev.get("event") == "REVIEW_REQUIRED":
            q = str(ev.get("question", "")).strip()
            if q:
                out.append(q[:160])
    return out


LOG_OUTCOME_WHY: dict[str, str] = {
    "confirmed": "Submission confirmed on site.",
    "navigation_failed": BLOCKER_WHY["navigation_failed"],
    "location_ineligible": "Job location / eligibility rules rejected this opening.",
    "careers_page": BLOCKER_WHY["careers_page"],
    "bad_job_url": "Sheet URL opened a board error page, not a single job posting.",
    "review_required": "Required screening question blocked (missing fact or empty field label).",
    "request_failed": "Worker error during apply (often screenshot timeout or n8n callback).",
    "no_confirmation": "Submit clicked but no confirmation signal (timeout or silent failure).",
    "captcha": BLOCKER_WHY["captcha"],
    "unconfirmed_page": "Job page could not be verified as the intended posting.",
    "unknown": "Opened in browser but no terminal outcome in logs.",
}


@dataclass
class JobLogAttempt:
    company: str
    role: str
    url: str
    outcome: str
    cause: str
    review_questions: list[str]


def _first_line(msg: str, limit: int = 140) -> str:
    text = str(msg or "").strip().split("\n", 1)[0]
    return text[:limit] if text else ""


def job_attempts_from_events(events: list[dict]) -> list[JobLogAttempt]:
    """One row per JOB_OPENED, with the best terminal cause from following log events."""
    sessions: list[dict] = []
    current: dict | None = None
    for ev in events:
        name = str(ev.get("event", ""))
        if name == "JOB_OPENED":
            current = {
                "company": str(ev.get("company", "?")),
                "role": str(ev.get("role", "?")),
                "url": str(ev.get("url", "")),
                "evs": [],
            }
            sessions.append(current)
            continue
        if current is not None:
            current["evs"].append(ev)

    attempts: list[JobLogAttempt] = []
    for session in sessions:
        evs = session["evs"]
        reviews: list[str] = []
        outcome = "unknown"
        cause = LOG_OUTCOME_WHY["unknown"]
        request_msg = ""

        for ev in evs:
            name = str(ev.get("event", ""))
            if name == "SUBMISSION_CONFIRMED":
                outcome = "confirmed"
                cause = LOG_OUTCOME_WHY["confirmed"]
            elif name == "JOB_NAVIGATION_FAILED":
                outcome = "navigation_failed"
                cause = BLOCKER_WHY["navigation_failed"]
            elif name == "JOB_LOCATION_INELIGIBLE":
                outcome = "location_ineligible"
                cause = LOG_OUTCOME_WHY["location_ineligible"]
            elif name == "JOB_PAGE_UNCONFIRMED":
                outcome = "unconfirmed_page"
                cause = LOG_OUTCOME_WHY["unconfirmed_page"]
            elif name == "REVIEW_REQUIRED":
                q = str(ev.get("question", "")).strip()
                reason = str(ev.get("reason", "")).strip()
                if q:
                    reviews.append(q)
                elif reason:
                    reviews.append(reason)
                if outcome not in ("confirmed",):
                    outcome = "review_required"
                    detail = q or _first_line(reason)
                    cause = (
                        f"Screening blocked: {detail}"
                        if detail
                        else LOG_OUTCOME_WHY["review_required"]
                    )
            elif name == "REQUEST_FAILED":
                request_msg = _first_line(str(ev.get("message", "")))
                if outcome != "confirmed":
                    outcome = "request_failed"
                    cause = request_msg or LOG_OUTCOME_WHY["request_failed"]
            elif name == "CAPTCHA_SIGNAL":
                signal = str(ev.get("signal", ""))
                if signal not in ("none", "passive_widget", "") and outcome != "confirmed":
                    outcome = "captcha"
                    cause = BLOCKER_WHY["captcha"]

        submitted = any(str(ev.get("event")) == "SUBMIT_CLICKED" for ev in evs)
        confirmed = any(str(ev.get("event")) == "SUBMISSION_CONFIRMED" for ev in evs)
        if submitted and not confirmed and outcome == "unknown":
            outcome = "no_confirmation"
            cause = LOG_OUTCOME_WHY["no_confirmation"]

        url = session["url"]
        if outcome == "unknown":
            form_fields: list[str] = []
            for ev in evs:
                if ev.get("event") == "FORM_DETECTED":
                    form_fields = [str(f) for f in (ev.get("fields") or [])]
            if form_fields and {"Search", "Office", "Career Page Department"}.intersection(form_fields):
                outcome = "careers_page"
                cause = BLOCKER_WHY["careers_page"]
            elif "error=true" in url.lower():
                outcome = "bad_job_url"
                cause = LOG_OUTCOME_WHY["bad_job_url"]

        if outcome == "review_required" and reviews:
            unique = list(dict.fromkeys(reviews))
            cause = "; ".join(unique[:3])
            if len(unique) > 3:
                cause += f" (+{len(unique) - 3} more)"

        attempts.append(
            JobLogAttempt(
                company=session["company"],
                role=session["role"],
                url=url,
                outcome=outcome,
                cause=cause.replace("|", "/"),
                review_questions=reviews,
            )
        )
    return attempts


def print_unanswered_questions(log_jobs: list[JobLogAttempt]) -> None:
    unanswered = [
        row
        for row in log_jobs
        if row.outcome == "review_required" and row.review_questions
    ]
    if not unanswered:
        return

    print("## Unanswered screening questions")
    print("These questions blocked automated submission and need an answer before retrying:")
    for row in unanswered:
        print(f"- **{row.company} — {row.role}**")
        for question in dict.fromkeys(row.review_questions):
            print(f"  - {question.replace(chr(10), ' ').strip()}")
    print()


def manual_queue_module():
    import importlib.util

    path = ROOT / "scripts" / "manual_apply_queue.py"
    spec = importlib.util.spec_from_file_location("manual_apply_queue", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("manual_apply_queue.py missing")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def print_manual_queue_block(day: str) -> None:
    mod = manual_queue_module()
    items = mod.load_manual_queue()
    if not items:
        return
    mod.print_markdown(items)
    print(f"Manual queue source already exists for `{day}`; report remains read-only.\n")


def print_report(day: str | None = None) -> int:
    day = day or jerusalem_today()
    token = load_token()
    now = datetime.now(TZ).strftime("%Y-%m-%d %H:%M %Z")

    health = http_json(HEALTH_URL) or {}
    quota = http_json(f"{WORKER_BASE}/quota", token) if token else None
    budget = http_json(f"{WORKER_BASE}/budget", token) if token else None

    attempt_cap = int(
        health.get("dailyApplySafetyAttempts")
        or quota.get("maxAttempts")
        if quota
        else 1000
    )
    worker_confirmed = int(quota.get("confirmed") if quota else 0)
    daily_budget = float(budget.get("dailyBudgetIls") or 0) if budget else 0
    daily_spent = float(budget.get("dailySpentIls") or 0) if budget else 0
    daily_remaining = float(budget.get("dailyRemainingIls") or 0) if budget else 0

    confirmed = confirmed_today(day)
    attempts = attempts_today(day)
    quota_rows = quota_rows_today(day)
    cv_count = count_generated_cvs(day)
    cv_linked = len(cv_paths_from_attempts(attempts))
    cv_orphan = max(0, cv_count - cv_linked)
    log_lines = docker_logs_today(day)
    events = parse_log_events(log_lines)
    event_names = Counter(str(e.get("event", "")) for e in events)

    job_opened = event_names.get("JOB_OPENED", 0)
    ledger_attempts = len(attempts)
    request_failed = event_names.get("REQUEST_FAILED", 0)
    review_events = event_names.get("REVIEW_REQUIRED", 0)
    opened_attempts = sum(1 for row in attempts if row.get("pipeline", {}).get("opened"))
    fit_passed = sum(1 for row in attempts if row.get("pipeline", {}).get("fitPassed"))
    fit_skipped = sum(
        1 for row in attempts
        if row.get("outcome") in {"not_relevant", "location_ineligible", "no_suitable_replacement"}
    )
    cv_generated = sum(1 for row in attempts if row.get("pipeline", {}).get("cvGenerated"))
    cv_quality_passed = sum(1 for row in attempts if row.get("pipeline", {}).get("cvQualityPassed"))
    submitted = sum(1 for row in attempts if row.get("pipeline", {}).get("submitted"))
    manual = sum(1 for row in attempts if row.get("outcome") == "manual_required")
    technical_failures = sum(
        1 for row in attempts
        if row.get("outcome") in {
            "navigation_failed",
            "form_not_detected",
            "form_validation",
            "cv_generation_failed",
            "confirmation_not_detected",
            "request_failed",
        }
    )

    mode = orchestration_mode()
    apply_runs = [] if mode == "native" else [r for r in n8n_runs_today(day) if r.workflow_id == APPLY_WF_ID]
    discover_runs = [] if mode == "native" else [r for r in n8n_runs_today(day) if r.workflow_id == DISCOVER_WF_ID]
    native_runs = native_runs_today(day) if mode == "native" else []
    discover_states = {
        run.execution_id: discover_execution_state(run.execution_id)
        for run in discover_runs
    }

    queue = sheet_queue_snapshot()
    discover_depth_threshold = int(
        quota.get("discoverySkipThreshold")
        if quota and quota.get("discoverySkipThreshold") is not None
        else attempt_cap * 3
    )
    sheet_new = queue["status_new"] if queue else None
    discover_should_skip = (
        isinstance(sheet_new, int) and sheet_new > discover_depth_threshold
    )

    eligible_attempts = len(attempts)

    def rate(numerator: int, denominator: int) -> str:
        return f"{(numerator / denominator * 100):.1f}%" if denominator else "n/a"

    print(f"# Daily apply report — {day}")
    print(f"_Generated {now}_\n")
    print(
        f"**{len(confirmed)} confirmed from {eligible_attempts} eligible attempts. "
        f"Daily budget: {daily_spent:.2f}/{daily_budget:.2f} ILS, "
        f"{daily_remaining:.2f} ILS remaining.**\n"
    )

    print("## Summary")
    print(f"| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| **Confirmed submissions** | **{len(confirmed)}** |")
    print(f"| Confirmed submissions (worker) | {worker_confirmed} |")
    print(f"| Daily budget ILS | {daily_spent:.2f} / {daily_budget:.2f} ({daily_remaining:.2f} remaining) |")
    print(f"| Attempt safety cap | {attempt_cap} |")
    print(f"| Worker attempts with terminal outcomes | {ledger_attempts} |")
    print(f"| Jobs opened (docker logs) | {job_opened} |")
    print(f"| CV PDFs in today's folder | {cv_count} ({cv_linked} tied to ledger, {cv_orphan} extra previews/retries) |")
    print(f"| n8n Pick Jobs (latest run) | {queue['pick_jobs_output'] if queue else '—'} |")
    print(f"| Worker container | {'up' if container_running() else 'down/missing'} |")
    print(f"| Daily budget available? | **{'yes' if daily_remaining > 0 else 'no'}** |")
    print()

    print("## Quality funnel")
    print(f"- Raw New queue: **{queue['status_new'] if queue else '—'}**")
    print(f"- Jobs prefiltered: **{queue['pick_jobs_output'] if queue else '—'}**")
    print(f"- Jobs opened: **{opened_attempts}**")
    print(f"- Full-JD fit passed: **{fit_passed}**; skipped: **{fit_skipped}**")
    print(f"- CV generated: **{cv_generated}**; CV quality passed: **{cv_quality_passed}**")
    print(f"- Submitted: **{submitted}**; confirmed: **{len(confirmed)}**")
    print(f"- Manual: **{manual}**; technical failures: **{technical_failures}**")
    print(
        f"- Rates: full JD → fit **{rate(fit_passed, opened_attempts)}**; "
        f"fit → CV pass **{rate(cv_quality_passed, fit_passed)}**; "
        f"CV pass → submit **{rate(submitted, cv_quality_passed)}**; "
        f"submit → confirm **{rate(len(confirmed), submitted)}**"
    )
    print()

    if queue:
        print("## Google Sheet queue (from latest apply run today)")
        print(
            f"- Rows read: **{queue['sheet_rows']}**; Status `New`: **{queue['status_new']}**; "
            f"eligible http(s) job URLs: **{queue['automatable_new']}**; "
            f"Pick Jobs output: **{queue['pick_jobs_output']}** (exec `{queue['execution_id']}`)"
        )
        skipped = queue["status_new"] - queue["automatable_new"]
        if skipped > 0:
            print(f"- **{skipped}** `New` rows have no usable http(s) link (or a known junk URL).")
        if queue["pick_jobs_output"] < attempt_cap and queue["automatable_new"] >= attempt_cap:
            print(
                f"- Eligible queue is **{queue['automatable_new']}**, but this run only picked **{queue['pick_jobs_output']}**. "
                f"Check the attempt safety cap of {attempt_cap}."
            )
        if discover_should_skip:
            print(
                f"- Discover **should be skipped**: `{queue['status_new']}` New rows > "
                f"{discover_depth_threshold} ({DISCOVER_SKIP_NEW_MULTIPLIER}× attempt safety cap {attempt_cap})."
            )
        print()

    if health:
        print("## Worker health")
        print(
            f"- LLM configured: {health.get('llmConfigured')}; "
            f"browser: {health.get('browserOk')}; "
            f"cost today USD: {health.get('llmCostUsdToday')}"
        )
        if budget:
            print(
                f"- Monthly budget ILS: {budget.get('spentIls')}/{budget.get('limitIls')} "
                f"({budget.get('remainingIls')} remaining)"
            )
            print(
                f"- Daily budget ILS: {budget.get('dailySpentIls')}/{budget.get('dailyBudgetIls')} "
                f"({budget.get('dailyRemainingIls')} remaining; {budget.get('daysRemaining')} days remaining)"
            )
        print()

    if mode == "native":
        print("## Native orchestration today")
        if not native_runs:
            print("- No native apply/discover runs logged (see data/ledger/native-runs.jsonl).")
        else:
            for row in native_runs:
                summary = row.get("summary") or {}
                print(
                    f"- **{row.get('kind')}** workspace `{row.get('workspaceId')}` "
                    f"**{row.get('status')}** ({row.get('runSource')}) — {summary}"
                )
        print()

    print("## n8n today" if mode != "native" else "## n8n today (inactive — ORCHESTRATION_MODE=native)")
    if mode == "native":
        print("- Job workflows should stay deactivated after native cutover.")
    elif not apply_runs and not discover_runs:
        print("- No apply/discover executions found in n8n DB (or postgres unreachable).")
    else:
        for r in discover_runs:
            state = discover_states.get(r.execution_id, "unknown")
            if state == "skipped":
                detail = " _(schedule fired; queue-depth gate skipped board scan)_"
            elif state == "scanned":
                detail = " _(board scan executed)_"
            else:
                detail = " _(board-scan state could not be verified)_"
            print(f"- Discover: exec `{r.execution_id}` **{r.status}** {r.started} → {r.stopped}{detail}")
        for r in apply_runs:
            print(f"- Apply: exec `{r.execution_id}` **{r.status}** {r.started} → {r.stopped}")
    print()

    log_jobs = job_attempts_from_events(events)
    print("## Jobs tried (worker logs — exact failure per opening)")
    if not log_jobs:
        print("- No `JOB_OPENED` events in today's docker logs.")
    else:
        print("| # | Outcome | Company | Role | Exact cause |")
        print("|---|---------|---------|------|-------------|")
        for i, row in enumerate(log_jobs, start=1):
            company = row.company[:26]
            role = row.role[:36]
            why = row.cause.replace("|", "/")[:160]
            print(f"| {i} | `{row.outcome}` | {company} | {role} | {why} |")
        print()

    print_unanswered_questions(log_jobs)

    print("## Apply attempts (worker ledger, chronological)")
    if not attempts:
        print("- No ledger attempts for this calendar day.")
        if cv_orphan:
            print(
                f"- **{cv_orphan}** CV PDF(s) exist without ledger rows — likely dry-runs, manual previews, "
                "or logs lost after container restart."
            )
    else:
        print("| # | Time (UTC) | Outcome | Company | Role | Why |")
        print("|---|------------|---------|---------|------|-----|")
        for i, row in enumerate(attempts, start=1):
            at = str(row.get("at", ""))[:19]
            outcome = attempt_outcome_label(row)
            company = str(row.get("company", "?"))[:28]
            role = str(row.get("role", "?"))[:40]
            why = failure_reason(row).replace("|", "/")[:120]
            print(f"| {i} | {at} | `{outcome}` | {company} | {role} | {why} |")
        if cv_orphan:
            print()
            print(
                f"- **{cv_orphan}** extra CV PDF(s) in today's folder are **not** tied to these ledger rows "
                "(dry-run / retry / manual preview)."
            )
        pick_n = queue["pick_jobs_output"] if queue else None
        if isinstance(pick_n, int) and pick_n > ledger_attempts:
            print(
                f"- n8n picked **{pick_n}** jobs but ledger shows **{ledger_attempts}** attempts — "
                "remaining rows may still be `applying`, failed before ledger write, or blocked in n8n."
            )
    print()

    if confirmed:
        print("## Confirmed applications (subset of attempts)")
        for row in confirmed:
            print(f"- {row.get('company', '?')}: {row.get('role', '?')[:60]}")
        print()

    if quota_rows:
        print("## Confirmed-application ledger")
        by_status = Counter(str(r.get("status", "?")) for r in quota_rows)
        for status, n in by_status.most_common():
            print(f"- `{status}`: {n}")
        print()

    print("## Log signals")
    for name, n in event_names.most_common(12):
        if name:
            print(f"- `{name}`: {n}")
    print()

    blockers: list[str] = []
    if job_opened == 0 and ledger_attempts > 0:
        blockers.append(
            "Docker logs for today lack `JOB_OPENED` (container likely restarted) — use the attempts table above."
        )
    if request_failed:
        blockers.append(
            f"**{request_failed}** worker `REQUEST_FAILED` errors (often HTTP 500 to n8n)."
        )
        for msg, n in top_failure_messages(events):
            blockers.append(f"  - ({n}×) {msg}")
    if review_events:
        blockers.append(f"**{review_events}** `REVIEW_REQUIRED` (manual screening answers).")
        for q in review_questions(events)[:5]:
            blockers.append(f"  - {q}")
    if budget and float(budget.get("remainingIls") or 0) <= 0:
        blockers.append("Monthly LLM budget exhausted (`budget_reached`).")
    elif budget and daily_remaining <= 0:
        blockers.append("Calculated daily budget exhausted (`budget_reached`).")
    deep_queue_discover_runs = [
        run for run in discover_runs
        if discover_states.get(run.execution_id) == "scanned"
    ]
    unverifiable_deep_queue_runs = [
        run for run in discover_runs
        if discover_states.get(run.execution_id) == "unknown"
    ]
    if deep_queue_discover_runs and discover_should_skip:
        blockers.append(
            f"Discover scanned boards while sheet had **{sheet_new}** `New` rows "
            f"(skip threshold **{discover_depth_threshold}**)."
        )
    elif unverifiable_deep_queue_runs and discover_should_skip:
        blockers.append(
            f"Could not verify whether {len(unverifiable_deep_queue_runs)} Discover execution(s) "
            f"scanned boards while sheet had **{sheet_new}** `New` rows "
            f"(skip threshold **{discover_depth_threshold}**)."
        )
    if not container_running():
        blockers.append("Worker container not running — no applies possible.")
    if not health.get("ok"):
        blockers.append("Worker `/health` not OK — check CV files, browser, LLM config.")

    print("## What stopped progress")
    if not blockers:
        print("- No dominant blocker in logs; continue while the calculated daily budget remains open.")
    else:
        for b in blockers:
            print(f"- {b}")
    print()

    print_manual_queue_block(day)

    failed_blockers = Counter(
        attempt_outcome_label(r) for r in attempts if not r.get("confirmationDetected")
    )

    print("## Suggested next steps")
    if any("Comeet careers.js" in b for b in blockers):
        print("- Fix Comeet submit: skip `file` inputs in `submit-application.ts` Angular sync loop; redeploy.")
    if failed_blockers.get("captcha", 0) >= 3:
        print(
            f"- **{failed_blockers['captcha']}** captcha blockers today — pause bulk apply; use "
            f"`python3 scripts/manual-apply-queue.py --html` and finish tabs manually."
        )
    if review_events or failed_blockers.get("missing_fact"):
        print("- Answer or tune screening rules for `REVIEW_REQUIRED` / missing-fact jobs; re-run apply for those rows.")
    if daily_remaining > 0 and not discover_should_skip and (not queue or queue["automatable_new"] < attempt_cap):
        print("- Sheet queue is thin — run discover or add `New` rows.")
    elif daily_remaining > 0 and discover_should_skip:
        print("- Queue is deep enough — **do not run discover**; fix apply blockers and re-run apply only.")
    if request_failed and ledger_attempts > 0 and len(confirmed) == 0:
        print("- Re-trigger apply after fix: n8n webhook `job-apply-run` or wait for scheduled apply.")
    print()

    return 0 if not blockers else 1


def main() -> None:
    day = sys.argv[1] if len(sys.argv) > 1 else None
    raise SystemExit(print_report(day))


if __name__ == "__main__":
    main()
