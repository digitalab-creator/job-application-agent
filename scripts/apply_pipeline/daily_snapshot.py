from __future__ import annotations

import importlib.util
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from apply_pipeline.config import daily_confirmed_target
from apply_pipeline.paths import ROOT

TZ = ZoneInfo("Asia/Jerusalem")


def _load_daily_report_module():
    path = ROOT / "scripts" / "daily-apply-report.py"
    spec = importlib.util.spec_from_file_location("daily_apply_report", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("daily-apply-report.py missing")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["daily_apply_report"] = mod
    spec.loader.exec_module(mod)
    return mod


def production_sha() -> str | None:
    try:
        raw = subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            text=True,
            timeout=10,
        ).strip()
        return raw[:40] if raw else None
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return None


def gather_daily_snapshot(day: str | None = None) -> dict[str, Any]:
    """Collect metrics for reporting and repair triggers (read-only)."""
    report = _load_daily_report_module()
    day = day or report.jerusalem_today()
    now = datetime.now(TZ).isoformat()

    token = report.load_token()
    health = report.http_json(report.HEALTH_URL) or {}
    quota = report.http_json(f"{report.WORKER_BASE}/quota", token) if token else None
    budget = report.http_json(f"{report.WORKER_BASE}/budget", token) if token else None

    attempt_cap = int(
        health.get("dailyApplySafetyAttempts")
        or (quota.get("maxAttempts") if quota else 1000)
    )
    worker_confirmed = int(quota.get("confirmed") if quota else 0)
    daily_budget = float(budget.get("dailyBudgetIls") or 0) if budget else 0
    daily_spent = float(budget.get("dailySpentIls") or 0) if budget else 0
    daily_remaining = float(budget.get("dailyRemainingIls") or 0) if budget else 0

    confirmed = report.confirmed_today(day)
    attempts = report.attempts_today(day)
    log_lines = report.docker_logs_today(day)
    events = report.parse_log_events(log_lines)
    queue = report.sheet_queue_snapshot()

    eligible_attempts = len([r for r in attempts if r.get("outcome") != "in_progress"])
    submitted = sum(1 for r in attempts if r.get("pipeline", {}).get("submitted"))
    opened_attempts = sum(1 for r in attempts if r.get("pipeline", {}).get("opened"))
    fit_passed = sum(1 for r in attempts if r.get("pipeline", {}).get("fitPassed"))
    cv_quality_passed = sum(1 for r in attempts if r.get("pipeline", {}).get("cvQualityPassed"))

    failed_blockers: dict[str, int] = {}
    for row in attempts:
        if row.get("confirmationDetected") or row.get("outcome") == "applied":
            continue
        label = report.attempt_outcome_label(row)
        failed_blockers[label] = failed_blockers.get(label, 0) + 1

    dominant_blockers = sorted(failed_blockers.items(), key=lambda item: (-item[1], item[0]))[:8]

    infra_blockers: list[str] = []
    if not report.container_running():
        infra_blockers.append("worker_container_down")
    if not health.get("ok"):
        infra_blockers.append("worker_health_not_ok")

    insufficient = False
    insufficient_reason = ""
    if not health and not attempts and not report.container_running():
        insufficient = True
        insufficient_reason = "no_health_and_no_attempts"

    actionable_queue = 0
    if queue:
        actionable_queue = int(queue.get("automatable_new") or queue.get("eligible_employment") or 0)

    recovery: list[str] = []
    if daily_remaining > 0 and actionable_queue < attempt_cap:
        recovery.append("run_discover_or_add_sheet_rows")
    if dominant_blockers and dominant_blockers[0][0] in ("navigation_failed", "cv_upload_failed", "form_not_detected"):
        recovery.append("code_fix_review_rows")
    if daily_remaining <= 0:
        recovery.append("wait_for_budget_reset")

    target = daily_confirmed_target()

    return {
        "schema_version": 1,
        "day": day,
        "timezone": "Asia/Jerusalem",
        "generated_at": now,
        "daily_target": target,
        "confirmed_count": len(confirmed),
        "worker_confirmed_count": worker_confirmed,
        "attempt_count": eligible_attempts,
        "submitted_count": submitted,
        "actionable_queue_size": actionable_queue,
        "funnel": {
            "opened": opened_attempts,
            "fit_passed": fit_passed,
            "cv_quality_passed": cv_quality_passed,
            "submitted": submitted,
            "confirmed": len(confirmed),
        },
        "dominant_blockers": [{"blocker": k, "count": v} for k, v in dominant_blockers],
        "recovery_opportunities": recovery,
        "production_sha": production_sha(),
        "infrastructure_failure": bool(infra_blockers),
        "infrastructure_blockers": infra_blockers,
        "insufficient_evidence": insufficient,
        "insufficient_evidence_reason": insufficient_reason,
        "budget": {
            "daily_spent_ils": daily_spent,
            "daily_budget_ils": daily_budget,
            "daily_remaining_ils": daily_remaining,
        },
        "queue": queue,
    }
