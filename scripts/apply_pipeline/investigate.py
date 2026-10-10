from __future__ import annotations

from typing import Any

from apply_pipeline.classify import classify_root_cause
from apply_pipeline.daily_snapshot import gather_daily_snapshot
from apply_pipeline.evidence import gather_evidence_bundle
from apply_pipeline.github_context import open_prs_matching
from apply_pipeline.policy import deployment_tier


def investigate_day(day: str | None = None) -> dict[str, Any]:
    snapshot = gather_daily_snapshot(day)
    classification = classify_root_cause(snapshot)
    evidence = gather_evidence_bundle(snapshot, classification)
    root = str(classification.get("root_cause"))
    prs = open_prs_matching(root.replace("_", " "))
    dev_ahead = evidence.get("github", {}).get("commits_on_dev_not_in_production")
    fix_in_dev_undeployed = isinstance(dev_ahead, int) and dev_ahead > 0

    decision = {
        "action": "record_only",
        "tier": deployment_tier(classification, set()),
        "reason": "default",
    }
    if prs:
        decision = {"action": "use_existing_pr", "tier": "B", "reason": "open_pr_exists", "prs": prs}
    elif fix_in_dev_undeployed and snapshot.get("infrastructure_failure"):
        decision = {"action": "deploy_when_authorized", "tier": "C", "reason": "fix_may_exist_on_dev"}
    elif classification.get("code_fix_likely"):
        decision = {"action": "prepare_code_fix", "tier": deployment_tier(classification, {"apply"}), "reason": "reproducible_defect_signal"}
    elif root in {"discovery_starvation", "no_suitable_vacancies"}:
        decision = {"action": "operational_recovery", "tier": "A", "reason": "supply_or_fit_not_code"}
    elif root == "login_captcha_manual_only":
        decision = {"action": "manual_shortlist", "tier": "A", "reason": "external_blocker"}

    return {
        "snapshot": snapshot,
        "classification": classification,
        "evidence": evidence,
        "repair_decision": decision,
    }
