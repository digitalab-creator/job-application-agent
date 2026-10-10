#!/usr/bin/env python3
"""End-to-end apply pipeline incident investigation and bounded repair."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from apply_pipeline.business_status import business_status_from_snapshot
from apply_pipeline.incidents import (
    create_incident,
    log_daily_business,
    record_incident,
    update_incident_status,
)
from apply_pipeline.investigate import investigate_day
from apply_pipeline.limits import check_incident_agent_budget, check_limits
from apply_pipeline.repair_agent import run_repair_agent
from apply_pipeline.verify_post_deploy import verify_business_recovery

TZ = ZoneInfo("Asia/Jerusalem")


def main() -> int:
    parser = argparse.ArgumentParser(description="Investigate and repair apply pipeline incidents.")
    parser.add_argument("--day", help="Asia/Jerusalem calendar day YYYY-MM-DD")
    parser.add_argument("--read-only", action="store_true", help="Investigate only; no agent or recovery")
    parser.add_argument("--json", action="store_true", help="Machine-readable output")
    parser.add_argument("--verify-deploy", metavar="SHA", help="Post-deploy business verification for SHA")
    args = parser.parse_args()

    if args.verify_deploy:
        result = verify_business_recovery(args.verify_deploy, day=args.day)
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("navigation_blocker_resolved") else 1

    report = investigate_day(args.day)
    snapshot = report["snapshot"]
    classification = report["classification"]
    status = business_status_from_snapshot(snapshot)

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

    if args.read_only:
        out = {**report, "business_status": status.as_dict(), "incident": None}
        if args.json:
            print(json.dumps(out, indent=2, ensure_ascii=False))
        else:
            _print_human(out)
        return status.exit_code

    from apply_pipeline.fingerprint import incident_fingerprint
    from apply_pipeline.triggers import evaluate_triggers

    trigger = evaluate_triggers(snapshot, end_of_day=True)
    fp = incident_fingerprint(snapshot, classification)
    allowed, limit_reason = check_limits(str(snapshot["day"]), fp)
    if not allowed:
        out = {**report, "skipped": limit_reason, "business_status": status.as_dict()}
        if args.json:
            print(json.dumps(out, indent=2, ensure_ascii=False))
        else:
            print(f"Repair skipped: {limit_reason}")
            _print_human(out)
        return 0

    incident = create_incident(snapshot, classification, trigger)
    update_incident_status(incident["incident_id"], "investigating")

    decision = report["repair_decision"]
    agent_result = {"status": "skipped", "reason": "not_requested"}
    tier = decision.get("tier", "C")

    if decision["action"] == "prepare_code_fix" and tier in {"B", "C"}:
        branch = f"repair/{incident['incident_id']}"
        if check_incident_agent_budget(incident["incident_id"], 5.0):
            agent_result = run_repair_agent(report["evidence"], branch, dry_run=False)
            record_incident(
                {
                    "kind": "agent_cost",
                    "incident_id": incident["incident_id"],
                    "day": snapshot["day"],
                    "usd": float(agent_result.get("estimated_usd") or 0),
                    "at": datetime.now(TZ).isoformat(),
                }
            )
        else:
            agent_result = {"status": "skipped", "reason": "incident_agent_budget"}

    update_incident_status(
        incident["incident_id"],
        "awaiting_review" if tier == "C" else "repair_prepared",
        decision=decision,
        agent=agent_result,
    )

    out = {
        **report,
        "business_status": status.as_dict(),
        "incident": incident,
        "agent": agent_result,
        "limits_ok": True,
    }
    if args.json:
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        _print_human(out)
    return 0


def _print_human(out: dict) -> None:
    snap = out["snapshot"]
    cls = out["classification"]
    dec = out["repair_decision"]
    print(f"# Pipeline repair — {snap['day']}")
    print(f"- Business: {out.get('business_status', {}).get('state')} ({snap['confirmed_count']}/{snap['daily_target']} confirmed)")
    print(f"- Root cause: **{cls['root_cause']}** (earliest stage: {cls['earliest_failing_stage']})")
    print(f"- Decision: {dec['action']} (tier {dec['tier']}) — {dec['reason']}")
    if out.get("incident"):
        print(f"- Incident: {out['incident']['incident_id']}")
    if out.get("agent"):
        print(f"- Agent: {out['agent']}")


if __name__ == "__main__":
    raise SystemExit(main())
