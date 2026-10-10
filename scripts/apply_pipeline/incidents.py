from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from apply_pipeline.fingerprint import incident_fingerprint
from apply_pipeline.jsonl_store import append_jsonl, read_jsonl
from apply_pipeline.paths import DAILY_BUSINESS_LOG, INCIDENTS_PATH

TZ = ZoneInfo("Asia/Jerusalem")


def new_incident_id() -> str:
    return f"inc-{datetime.now(TZ).strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"


def log_daily_business(row: dict[str, Any]) -> None:
    append_jsonl(DAILY_BUSINESS_LOG, row)


def record_incident(row: dict[str, Any]) -> None:
    append_jsonl(INCIDENTS_PATH, row)


def create_incident(
    snapshot: dict[str, Any],
    classification: dict[str, Any],
    trigger: dict[str, Any],
) -> dict[str, Any]:
    fp = incident_fingerprint(snapshot, classification)
    incident_id = new_incident_id()
    now = datetime.now(TZ).isoformat()
    row = {
        "kind": "incident",
        "incident_id": incident_id,
        "at": now,
        "day": snapshot.get("day"),
        "fingerprint": fp,
        "status": "open",
        "trigger_reasons": trigger.get("reasons"),
        "root_cause": classification.get("root_cause"),
        "earliest_stage": classification.get("earliest_failing_stage"),
        "business_state": trigger.get("business_state"),
    }
    record_incident(row)
    return row


def update_incident_status(incident_id: str, status: str, **extra: Any) -> None:
    record_incident(
        {
            "kind": "incident_status",
            "incident_id": incident_id,
            "at": datetime.now(TZ).isoformat(),
            "status": status,
            **extra,
        }
    )


def latest_incidents(limit: int = 20) -> list[dict[str, Any]]:
    return [r for r in read_jsonl(INCIDENTS_PATH) if r.get("kind") == "incident"][-limit:]
