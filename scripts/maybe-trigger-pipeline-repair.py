#!/usr/bin/env python3
"""Evaluate whether to start /repair-apply-pipeline (deduped, cooldown-aware)."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from apply_pipeline.business_status import business_status_from_snapshot
from apply_pipeline.classify import classify_root_cause
from apply_pipeline.daily_snapshot import gather_daily_snapshot
from apply_pipeline.fingerprint import incident_fingerprint
from apply_pipeline.incidents import log_daily_business
from apply_pipeline.limits import check_limits
from apply_pipeline.triggers import evaluate_triggers

TZ = ZoneInfo("Asia/Jerusalem")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--end-of-day", action="store_true")
    parser.add_argument("--spawn", action="store_true", help="Launch repair-apply-pipeline.py when triggered")
    args = parser.parse_args()

    snapshot = gather_daily_snapshot()
    status = business_status_from_snapshot(snapshot)
    classification = classify_root_cause(snapshot)
    trigger = evaluate_triggers(snapshot, end_of_day=args.end_of_day)
    fp = incident_fingerprint(snapshot, classification)
    allowed, limit_reason = check_limits(str(snapshot["day"]), fp)

    log_daily_business(
        {
            "day": snapshot["day"],
            "at": datetime.now(TZ).isoformat(),
            "business_state": status.state,
            "confirmed": snapshot["confirmed_count"],
            "target": snapshot["daily_target"],
            "root_cause": classification["root_cause"],
        }
    )

    payload = {
        "should_trigger": trigger["should_trigger"] and allowed,
        "trigger": trigger,
        "limits": {"allowed": allowed, "reason": limit_reason},
        "fingerprint": fp,
        "business_status": status.as_dict(),
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    elif payload["should_trigger"]:
        print(f"pipeline-repair trigger: {trigger['reasons']} (fp={fp})")
    else:
        print(f"pipeline-repair idle: {limit_reason if not allowed else trigger['reasons'] or status.state}")

    if payload["should_trigger"] and args.spawn:
        subprocess.Popen(
            [sys.executable, str(ROOT / "scripts" / "repair-apply-pipeline.py"), "--json"],
            cwd=str(ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
