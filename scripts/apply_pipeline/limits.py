from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from apply_pipeline.config import (
    MAX_INCIDENT_HOURS,
    MAX_REPAIR_AGENT_USD_PER_DAY,
    MAX_REPAIR_AGENT_USD_PER_INCIDENT,
    MAX_REPAIRS_PER_DAY,
    MAX_RETRIES_PER_FINGERPRINT,
    REPAIR_COOLDOWN_MINUTES,
)
from apply_pipeline.jsonl_store import read_jsonl
from apply_pipeline.paths import INCIDENTS_PATH, REPAIR_STATE_PATH

TZ = ZoneInfo("Asia/Jerusalem")


def _parse_ts(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(TZ)
    except (TypeError, ValueError):
        return None


def repairs_today(day: str) -> list[dict[str, Any]]:
    rows = read_jsonl(INCIDENTS_PATH)
    return [r for r in rows if str(r.get("day")) == day and r.get("kind") == "repair_attempt"]


def active_incident_for_fingerprint(fingerprint: str) -> dict[str, Any] | None:
    for row in reversed(read_jsonl(INCIDENTS_PATH)):
        if row.get("fingerprint") != fingerprint:
            continue
        if row.get("status") in {"open", "investigating", "repairing"}:
            return row
    return None


def fingerprint_retry_count(fingerprint: str) -> int:
    return sum(
        1
        for row in read_jsonl(INCIDENTS_PATH)
        if row.get("fingerprint") == fingerprint and row.get("kind") == "repair_attempt"
    )


def last_failed_repair_at() -> datetime | None:
    for row in reversed(read_jsonl(INCIDENTS_PATH)):
        if row.get("kind") == "repair_attempt" and row.get("status") == "failed":
            return _parse_ts(str(row.get("at", "")))
    return None


def agent_spend_today_usd(day: str) -> float:
    total = 0.0
    for row in read_jsonl(INCIDENTS_PATH):
        if str(row.get("day")) != day:
            continue
        if row.get("kind") != "agent_cost":
            continue
        total += float(row.get("usd") or 0)
    return total


def check_limits(day: str, fingerprint: str) -> tuple[bool, str]:
    if len(repairs_today(day)) >= MAX_REPAIRS_PER_DAY:
        return False, f"max_repairs_per_day={MAX_REPAIRS_PER_DAY}"

    if fingerprint_retry_count(fingerprint) >= MAX_RETRIES_PER_FINGERPRINT:
        return False, f"max_retries_per_fingerprint={MAX_RETRIES_PER_FINGERPRINT}"

    active = active_incident_for_fingerprint(fingerprint)
    if active:
        return False, f"active_incident={active.get('incident_id')}"

    failed_at = last_failed_repair_at()
    if failed_at:
        cooldown = timedelta(minutes=REPAIR_COOLDOWN_MINUTES)
        if datetime.now(TZ) - failed_at < cooldown:
            return False, "cooldown_after_failed_repair"

    if agent_spend_today_usd(day) >= MAX_REPAIR_AGENT_USD_PER_DAY:
        return False, "daily_agent_budget_exhausted"

    return True, "ok"


def check_incident_agent_budget(incident_id: str, proposed_usd: float) -> bool:
    spent = 0.0
    for row in read_jsonl(INCIDENTS_PATH):
        if row.get("incident_id") == incident_id and row.get("kind") == "agent_cost":
            spent += float(row.get("usd") or 0)
    return spent + proposed_usd <= MAX_REPAIR_AGENT_USD_PER_INCIDENT


def incident_expired(started_at: str) -> bool:
    started = _parse_ts(started_at)
    if not started:
        return False
    return datetime.now(TZ) - started > timedelta(hours=MAX_INCIDENT_HOURS)
