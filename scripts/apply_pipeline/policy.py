from __future__ import annotations

from typing import Any

TIER_A_ROOTS = frozenset({"discovery_starvation"})
TIER_B_ROOTS = frozenset({
    "ats_navigation_defect",
    "cv_generation_or_upload_defect",
    "form_or_submission_defect",
    "unconfirmed_submission",
    "incorrect_fit_rejection",
})
TIER_C_ALWAYS = frozenset({
    "deployment_config_mismatch",
})


def deployment_tier(classification: dict[str, Any], fix_touches: set[str]) -> str:
    root = str(classification.get("root_cause") or "unknown")
    sensitive = {
        "auth",
        "secrets",
        "ledger",
        "duplicate",
        "submission_policy",
        "migration",
        "candidate_facts",
    }
    if fix_touches.intersection(sensitive):
        return "C"
    if root in TIER_C_ALWAYS:
        return "C"
    if root in TIER_A_ROOTS:
        return "A"
    if root in TIER_B_ROOTS and classification.get("code_fix_likely"):
        return "B"
    return "C"


def auto_merge_allowed(tier: str) -> bool:
    return tier == "B" and False  # PR only until explicit preapproval wiring exists.
