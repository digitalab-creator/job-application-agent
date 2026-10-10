from __future__ import annotations

from collections import Counter
from typing import Any

ROOT_CAUSES = (
    "discovery_starvation",
    "invalid_or_dead_vacancy_urls",
    "insufficient_job_description",
    "incorrect_fit_rejection",
    "ats_navigation_defect",
    "cv_generation_or_upload_defect",
    "form_or_submission_defect",
    "unconfirmed_submission",
    "login_captcha_manual_only",
    "budget_exhaustion",
    "deployment_config_mismatch",
    "no_suitable_vacancies",
    "unknown",
)

_BLOCKER_TO_ROOT: dict[str, str] = {
    "navigation_failed": "ats_navigation_defect",
    "request_failed": "ats_navigation_defect",
    "cv_upload_failed": "cv_generation_or_upload_defect",
    "cv_generation_failed": "cv_generation_or_upload_defect",
    "form_not_detected": "form_or_submission_defect",
    "form_validation": "form_or_submission_defect",
    "missing_fact": "form_or_submission_defect",
    "submit_not_accepted": "form_or_submission_defect",
    "confirmation_not_detected": "unconfirmed_submission",
    "full_job_fit_failed": "incorrect_fit_rejection",
    "not_relevant": "incorrect_fit_rejection",
    "location_ineligible": "no_suitable_vacancies",
    "no_suitable_replacement": "no_suitable_vacancies",
    "invalid_url": "invalid_or_dead_vacancy_urls",
    "careers_page": "invalid_or_dead_vacancy_urls",
    "no_matching_opening": "invalid_or_dead_vacancy_urls",
    "captcha": "login_captcha_manual_only",
    "login_required": "login_captcha_manual_only",
    "manual_required": "login_captcha_manual_only",
    "quota_reached": "budget_exhaustion",
    "budget_reached": "budget_exhaustion",
    "already_submitted": "unknown",
}


def classify_root_cause(snapshot: dict[str, Any]) -> dict[str, Any]:
    blockers = snapshot.get("dominant_blockers") or []
    queue = snapshot.get("queue") or {}
    budget = snapshot.get("budget") or {}
    funnel = snapshot.get("funnel") or {}

    counts = Counter()
    for item in blockers:
        key = str(item.get("blocker") or "unknown")
        counts[_BLOCKER_TO_ROOT.get(key, "unknown")] += int(item.get("count") or 0)

    actionable = int(snapshot.get("actionable_queue_size") or 0)
    target = int(snapshot.get("daily_target") or 10)
    confirmed = int(snapshot.get("confirmed_count") or 0)
    attempts = int(snapshot.get("attempt_count") or 0)

    if float(budget.get("daily_remaining_ils") or 0) <= 0:
        counts["budget_exhaustion"] += 3

    if actionable < target and attempts > 0 and confirmed == 0:
        counts["discovery_starvation"] += 2

    if funnel.get("opened", 0) == 0 and attempts > 0:
        counts["deployment_config_mismatch"] += 1

    if not counts:
        if confirmed >= target:
            root = "unknown"
        elif actionable == 0:
            root = "discovery_starvation" if int(queue.get("status_new") or 0) == 0 else "no_suitable_vacancies"
        else:
            root = "no_suitable_vacancies"
    else:
        root = counts.most_common(1)[0][0]

    earliest_stage = "confirmed"
    if confirmed < target:
        if funnel.get("opened", 0) == 0:
            earliest_stage = "open_job"
        elif funnel.get("fit_passed", 0) == 0:
            earliest_stage = "fit_gate"
        elif funnel.get("cv_quality_passed", 0) == 0:
            earliest_stage = "cv_pipeline"
        elif funnel.get("submitted", 0) == 0:
            earliest_stage = "submit"
        else:
            earliest_stage = "confirmation"

    return {
        "root_cause": root,
        "root_cause_scores": dict(counts),
        "earliest_failing_stage": earliest_stage,
        "code_fix_likely": root
        in {
            "ats_navigation_defect",
            "cv_generation_or_upload_defect",
            "form_or_submission_defect",
            "unconfirmed_submission",
            "incorrect_fit_rejection",
        },
    }
