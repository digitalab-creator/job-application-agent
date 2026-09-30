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
ENV_FILE = ROOT / ".env"
LEDGER = ROOT / "data/ledger/applications.jsonl"
QUOTA_LEDGER = ROOT / "data/ledger/daily-quota.jsonl"
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
    "dry_run": "Intentional preview (`submit: false`) — not a failed apply.",
}

COMEET_SIZE_ERROR = re.compile(r"reading 'size'", re.I)
N8N_ENV = Path("/opt/apps/n8n/.env")


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
    for row in read_jsonl(LEDGER):
        if not row.get("confirmationDetected"):
            continue
        if row_on_day(str(row.get("at", "")), day):
            out.append(row)
    return out


def attempts_today(day: str) -> list[dict]:
    out: list[dict] = []
    for row in read_jsonl(LEDGER):
        if not row_on_day(str(row.get("at", "")), day):
            continue
        out.append(row)
    out.sort(key=lambda r: str(r.get("at", "")))
    return out


def attempt_outcome_label(row: dict) -> str:
    if row.get("confirmationDetected"):
        return "confirmed"
    blocker = str(row.get("blocker") or "").strip()
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
    out = mod.OUT_DIR / f"{day}.html"
    mod.write_html(items, out)
    print(f"Manual queue tabs page: `{out}` (open in browser — **Open application** on each card)\n")


def print_report(day: str | None = None) -> int:
    day = day or jerusalem_today()
    token = load_token()
    now = datetime.now(TZ).strftime("%Y-%m-%d %H:%M %Z")

    health = http_json(HEALTH_URL) or {}
    quota = http_json(f"{WORKER_BASE}/quota", token) if token else None
    budget = http_json(f"{WORKER_BASE}/budget", token) if token else None

    limit = int(health.get("dailyApplyLimit") or quota.get("limit") if quota else 20)
    counted = int(health.get("dailyApplyCounted") or quota.get("counted") if quota else 0)
    remaining = int(quota.get("remaining") if quota else max(0, limit - counted))

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

    apply_runs = [r for r in n8n_runs_today(day) if r.workflow_id == APPLY_WF_ID]
    discover_runs = [r for r in n8n_runs_today(day) if r.workflow_id == DISCOVER_WF_ID]

    queue = sheet_queue_snapshot()
    discover_depth_threshold = limit * DISCOVER_SKIP_NEW_MULTIPLIER
    sheet_new = queue["status_new"] if queue else None
    discover_should_skip = (
        isinstance(sheet_new, int) and sheet_new > discover_depth_threshold
    )

    met_target = len(confirmed) >= limit

    print(f"# Daily apply report — {day}")
    print(f"_Generated {now}_\n")

    print("## Summary")
    print(f"| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Daily limit | {limit} |")
    print(f"| **Confirmed submissions** | **{len(confirmed)}** |")
    print(f"| Quota counted (worker) | {counted} / {limit} ({remaining} remaining) |")
    print(f"| Worker ledger attempts | {ledger_attempts} |")
    print(f"| Jobs opened (docker logs) | {job_opened} |")
    print(f"| CV PDFs in today's folder | {cv_count} ({cv_linked} tied to ledger, {cv_orphan} extra previews/retries) |")
    print(f"| n8n Pick Jobs (latest run) | {queue['pick_jobs_output'] if queue else '—'} |")
    print(f"| Worker container | {'up' if container_running() else 'down/missing'} |")
    print(f"| Met {limit}-apply target? | **{'yes' if met_target else 'no'}** |")
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
        if queue["pick_jobs_output"] < limit and queue["automatable_new"] >= limit:
            print(
                f"- Eligible queue is **{queue['automatable_new']}**, but this run only picked **{queue['pick_jobs_output']}**. "
                "Check the Pick Jobs mix (13 tech / 7 marketing) and daily cap of 20."
            )
        if discover_should_skip:
            print(
                f"- Discover **should be skipped**: `{queue['status_new']}` New rows > "
                f"{discover_depth_threshold} ({DISCOVER_SKIP_NEW_MULTIPLIER}× daily limit {limit})."
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
        print()

    print("## n8n today")
    if not apply_runs and not discover_runs:
        print("- No apply/discover executions found in n8n DB (or postgres unreachable).")
    else:
        for r in discover_runs:
            flag = ""
            if discover_should_skip:
                flag = " _(ran despite deep queue — should skip after worker deploy)_"
            print(f"- Discover: exec `{r.execution_id}` **{r.status}** {r.started} → {r.stopped}{flag}")
        for r in apply_runs:
            print(f"- Apply: exec `{r.execution_id}` **{r.status}** {r.started} → {r.stopped}")
    print()

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
        print("## Quota ledger (counts toward daily limit)")
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
    if len(confirmed) < limit and ledger_attempts < limit:
        if queue and queue["pick_jobs_output"] < limit and queue["automatable_new"] >= limit:
            blockers.append(
                f"Eligible `New` URLs: **{queue['automatable_new']}**, but Pick Jobs only output **{queue['pick_jobs_output']}**."
            )
        elif pick_n := (queue["pick_jobs_output"] if queue else None):
            if isinstance(pick_n, int) and pick_n > ledger_attempts:
                blockers.append(
                    f"n8n picked **{pick_n}** jobs but only **{ledger_attempts}** reached the worker ledger."
                )
            else:
                blockers.append(
                    f"Only **{ledger_attempts}** worker attempts logged (target {limit})."
                )
        else:
            blockers.append(
                f"Only **{ledger_attempts}** worker attempts logged (target {limit})."
            )
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
    if counted >= limit and len(confirmed) < limit:
        blockers.append("Daily quota exhausted before enough confirmed submissions.")
    if budget and float(budget.get("remainingIls") or 0) <= 0:
        blockers.append("Monthly LLM budget exhausted (`budget_reached`).")
    if discover_runs and discover_should_skip:
        blockers.append(
            f"Discover ran while sheet had **{sheet_new}** `New` rows (skip threshold **{discover_depth_threshold}**)."
        )
    if not container_running():
        blockers.append("Worker container not running — no applies possible.")
    if not health.get("ok"):
        blockers.append("Worker `/health` not OK — check CV files, browser, LLM config.")

    print("## What stopped progress")
    if not blockers:
        if met_target:
            print("- Nothing critical; daily target met.")
        else:
            print("- No dominant blocker in logs; check sheet queue and n8n execution details.")
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
    if len(confirmed) < limit and not discover_should_skip and (not queue or queue["automatable_new"] < limit):
        print("- Sheet queue is thin — run discover or add `New` rows.")
    elif len(confirmed) < limit and discover_should_skip:
        print("- Queue is deep enough — **do not run discover**; fix apply blockers and re-run apply only.")
    if request_failed and ledger_attempts > 0 and len(confirmed) == 0:
        print("- Re-trigger apply after fix: n8n webhook `job-apply-run` or wait for scheduled apply.")
    print()

    return 0 if met_target else 1


def main() -> None:
    day = sys.argv[1] if len(sys.argv) > 1 else None
    raise SystemExit(print_report(day))


if __name__ == "__main__":
    main()
