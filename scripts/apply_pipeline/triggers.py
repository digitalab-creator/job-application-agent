from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from apply_pipeline.business_status import business_status_from_snapshot
from apply_pipeline.jsonl_store import read_jsonl
from apply_pipeline.paths import DAILY_BUSINESS_LOG

TZ = ZoneInfo("Asia/Jerusalem")


def _missed_target_days_before(day: str, streak: int) -> bool:
    try:
        anchor = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=TZ)
    except ValueError:
        return False
    days = [(anchor - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(1, streak + 1)]
    by_day = {str(r.get("day")): r for r in read_jsonl(DAILY_BUSINESS_LOG)}
    for d in days:
        row = by_day.get(d)
        if not row:
            return False
        if row.get("business_state") != "target_missed":
            return False
    return True


def evaluate_triggers(snapshot: dict[str, Any], *, end_of_day: bool = False) -> dict[str, Any]:
    """Return whether autonomous repair should start and why."""
    status = business_status_from_snapshot(snapshot)
    reasons: list[str] = []
    confirmed = int(snapshot.get("confirmed_count") or 0)
    target = int(snapshot.get("daily_target") or 0)
    attempts = int(snapshot.get("attempt_count") or 0)
    queue = snapshot.get("queue") or {}
    actionable = int(snapshot.get("actionable_queue_size") or 0)

    if status.state == "infrastructure_failure":
        reasons.append("infrastructure_failure")
    if status.state == "target_missed" and confirmed == 0 and attempts > 0:
        reasons.append("zero_confirmed_with_attempts")
    if status.state == "target_missed" and end_of_day:
        reasons.append("end_of_day_target_missed")
    if confirmed < target and actionable >= target and attempts == 0 and not snapshot.get("infrastructure_failure"):
        reasons.append("stalled_with_usable_queue")
    blockers = snapshot.get("dominant_blockers") or []
    if blockers and attempts >= 5:
        top = blockers[0]
        if int(top.get("count") or 0) >= max(3, attempts // 2):
            reasons.append(f"repeated_stage_failure:{top.get('blocker')}")
    if _missed_target_days_before(str(snapshot.get("day")), 3):
        reasons.append("three_consecutive_target_missed_days")
    if int(queue.get("status_new") or 0) == 0 and actionable == 0 and confirmed < target:
        reasons.append("queue_exhausted_no_replenish")

    # Do not trigger on individual application failures only.
    if blockers and reasons == [f"repeated_stage_failure:{blockers[0].get('blocker')}"] and attempts < 5:
        reasons.clear()

    should = bool(reasons) and status.state != "target_met"
    return {
        "should_trigger": should,
        "reasons": reasons,
        "business_state": status.state,
    }
