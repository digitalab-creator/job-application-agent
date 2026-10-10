import tempfile
import unittest
from pathlib import Path
from unittest import mock

from apply_pipeline import limits


class LimitsTests(unittest.TestCase):
    def test_fingerprint_retry_cap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "incidents.jsonl"
            path.write_text(
                "\n".join(
                    [
                        '{"kind":"repair_attempt","fingerprint":"abc123","day":"2026-10-07"}',
                        '{"kind":"repair_attempt","fingerprint":"abc123","day":"2026-10-07"}',
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            with mock.patch.object(limits, "INCIDENTS_PATH", path):
                with mock.patch.object(limits, "repairs_today", return_value=[]):
                    allowed, reason = limits.check_limits("2026-10-07", "abc123")
                    self.assertFalse(allowed)
                    self.assertIn("max_retries", reason)


if __name__ == "__main__":
    unittest.main()
