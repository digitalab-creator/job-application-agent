import unittest

from apply_pipeline.business_status import business_status_from_snapshot


class BusinessStatusTests(unittest.TestCase):
    def test_target_met(self) -> None:
        snap = {"confirmed_count": 10, "daily_target": 10, "infrastructure_failure": False}
        status = business_status_from_snapshot(snap)
        self.assertEqual(status.state, "target_met")
        self.assertEqual(status.exit_code, 0)

    def test_target_missed_zero_confirmed(self) -> None:
        snap = {"confirmed_count": 0, "daily_target": 10, "infrastructure_failure": False}
        status = business_status_from_snapshot(snap)
        self.assertEqual(status.state, "target_missed")
        self.assertEqual(status.exit_code, 1)

    def test_infrastructure_failure(self) -> None:
        snap = {
            "confirmed_count": 0,
            "daily_target": 10,
            "infrastructure_failure": True,
            "infrastructure_blockers": ["worker_container_down"],
        }
        status = business_status_from_snapshot(snap)
        self.assertEqual(status.state, "infrastructure_failure")
        self.assertEqual(status.exit_code, 2)

    def test_insufficient_evidence(self) -> None:
        snap = {
            "confirmed_count": 0,
            "daily_target": 10,
            "insufficient_evidence": True,
            "infrastructure_failure": False,
        }
        status = business_status_from_snapshot(snap)
        self.assertEqual(status.state, "insufficient_evidence")
        self.assertEqual(status.exit_code, 3)


if __name__ == "__main__":
    unittest.main()
