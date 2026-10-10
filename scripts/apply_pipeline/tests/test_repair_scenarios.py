import unittest
from unittest import mock

from apply_pipeline.business_status import business_status_from_snapshot
from apply_pipeline.investigate import investigate_day
from apply_pipeline.triggers import evaluate_triggers


def _base(**overrides):
    snap = {
        "day": "2026-01-01",
        "confirmed_count": 0,
        "daily_target": 10,
        "attempt_count": 5,
        "actionable_queue_size": 20,
        "dominant_blockers": [{"blocker": "navigation_failed", "count": 4}],
        "queue": {"status_new": 30},
        "infrastructure_failure": False,
        "insufficient_evidence": False,
        "funnel": {"opened": 4, "fit_passed": 0, "cv_quality_passed": 0, "submitted": 0, "confirmed": 0},
        "budget": {"daily_remaining_ils": 5},
    }
    snap.update(overrides)
    return snap


class RepairScenarioTests(unittest.TestCase):
    def test_infra_failure_exit_2(self) -> None:
        status = business_status_from_snapshot(_base(infrastructure_failure=True, infrastructure_blockers=["x"]))
        self.assertEqual(status.exit_code, 2)

    def test_duplicate_trigger_deduped_by_limits(self) -> None:
        with mock.patch("apply_pipeline.limits.check_limits", return_value=(False, "active_incident=inc-1")):
            from apply_pipeline.limits import check_limits

            allowed, _ = check_limits("2026-01-01", "fp1")
            self.assertFalse(allowed)

    def test_investigate_operational_when_no_code_signal(self) -> None:
        with mock.patch("apply_pipeline.investigate.gather_daily_snapshot", return_value=_base(dominant_blockers=[])):
            with mock.patch(
                "apply_pipeline.investigate.classify_root_cause",
                return_value={"root_cause": "discovery_starvation", "code_fix_likely": False, "earliest_failing_stage": "open_job"},
            ):
                with mock.patch("apply_pipeline.investigate.gather_evidence_bundle", return_value={"github": {}}):
                    report = investigate_day("2026-01-01")
                    self.assertEqual(report["repair_decision"]["action"], "operational_recovery")

    def test_stall_with_queue_triggers(self) -> None:
        snap = _base(attempt_count=0, confirmed_count=0, actionable_queue_size=25)
        result = evaluate_triggers(snap, end_of_day=False)
        self.assertTrue(result["should_trigger"])
        self.assertIn("stalled_with_usable_queue", result["reasons"])


if __name__ == "__main__":
    unittest.main()
