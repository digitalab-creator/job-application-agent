from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INCIDENTS_PATH = ROOT / "data" / "ledger" / "pipeline-repair-incidents.jsonl"
DAILY_BUSINESS_LOG = ROOT / "data" / "ledger" / "daily-business-reports.jsonl"
REPAIR_STATE_PATH = ROOT / "data" / "ledger" / "pipeline-repair-state.json"
BUG_PATTERNS_PATH = ROOT / "docs" / "bug-patterns" / "BUG_PATTERNS.md"
