import unittest

from apply_pipeline.fingerprint import incident_fingerprint
from apply_pipeline.policy import deployment_tier


class PolicyTests(unittest.TestCase):
    def test_tier_c_for_secrets(self) -> None:
        tier = deployment_tier({"root_cause": "ats_navigation_defect", "code_fix_likely": True}, {"secrets"})
        self.assertEqual(tier, "C")

    def test_fingerprint_stable(self) -> None:
        snap = {"dominant_blockers": [{"blocker": "navigation_failed", "count": 3}]}
        cls = {"root_cause": "ats_navigation_defect", "earliest_failing_stage": "fit_gate"}
        a = incident_fingerprint(snap, cls)
        b = incident_fingerprint(snap, cls)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
