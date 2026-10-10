import unittest

from apply_pipeline.triggers import evaluate_triggers


class TriggerTests(unittest.TestCase):
    def test_zero_confirmed_with_attempts(self) -> None:
        snap = {
            "day": "2026-10-07",
            "confirmed_count": 0,
            "daily_target": 10,
            "attempt_count": 12,
            "actionable_queue_size": 5,
            "dominant_blockers": [{"blocker": "navigation_failed", "count": 6}],
            "queue": {"status_new": 10},
            "infrastructure_failure": False,
        }
        result = evaluate_triggers(snap, end_of_day=True)
        self.assertTrue(result["should_trigger"])
        self.assertIn("zero_confirmed_with_attempts", result["reasons"])

    def test_target_met_no_trigger(self) -> None:
        snap = {
            "day": "2026-10-08",
            "confirmed_count": 10,
            "daily_target": 10,
            "attempt_count": 5,
            "actionable_queue_size": 20,
            "dominant_blockers": [],
            "queue": {},
            "infrastructure_failure": False,
        }
        result = evaluate_triggers(snap, end_of_day=True)
        self.assertFalse(result["should_trigger"])


if __name__ == "__main__":
    unittest.main()
