import unittest

from apply_pipeline.classify import classify_root_cause


class ClassifyTests(unittest.TestCase):
    def test_budget_exhaustion(self) -> None:
        snap = {
            "confirmed_count": 0,
            "daily_target": 10,
            "attempt_count": 2,
            "actionable_queue_size": 0,
            "dominant_blockers": [],
            "budget": {"daily_remaining_ils": 0},
            "funnel": {},
            "queue": {},
        }
        result = classify_root_cause(snap)
        self.assertEqual(result["root_cause"], "budget_exhaustion")

    def test_navigation_from_blocker(self) -> None:
        snap = {
            "confirmed_count": 0,
            "daily_target": 10,
            "attempt_count": 8,
            "actionable_queue_size": 30,
            "dominant_blockers": [{"blocker": "navigation_failed", "count": 5}],
            "budget": {"daily_remaining_ils": 10},
            "funnel": {"opened": 3, "fit_passed": 0},
            "queue": {},
        }
        result = classify_root_cause(snap)
        self.assertEqual(result["root_cause"], "ats_navigation_defect")
        self.assertEqual(result["earliest_failing_stage"], "fit_gate")


if __name__ == "__main__":
    unittest.main()
