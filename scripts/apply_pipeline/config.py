from __future__ import annotations

import os
from pathlib import Path

from apply_pipeline.paths import ROOT

ENV_FILE = ROOT / ".env"


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return parsed if parsed >= 0 else default


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def daily_confirmed_target() -> int:
    """Align with TS `DAILY_CONFIRMED_APPLICATIONS_TARGET` and legacy `DAILY_APPLY_LIMIT`."""
    for key in ("DAILY_CONFIRMED_APPLICATIONS_TARGET", "DAILY_APPLY_LIMIT"):
        raw = os.environ.get(key, "").strip()
        if raw:
            try:
                value = int(raw)
                if value >= 1:
                    return value
            except ValueError:
                continue
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key not in ("DAILY_CONFIRMED_APPLICATIONS_TARGET", "DAILY_APPLY_LIMIT"):
                continue
            try:
                parsed = int(value.strip())
                if parsed >= 1:
                    return parsed
            except ValueError:
                continue
    return 10


# Repair budgets (override via env for ops tuning).
MAX_REPAIRS_PER_DAY = env_int("PIPELINE_REPAIR_MAX_PER_DAY", 2)
MAX_RETRIES_PER_FINGERPRINT = env_int("PIPELINE_REPAIR_MAX_RETRIES_PER_FINGERPRINT", 2)
REPAIR_COOLDOWN_MINUTES = env_int("PIPELINE_REPAIR_COOLDOWN_MINUTES", 180)
MAX_INCIDENT_HOURS = env_int("PIPELINE_REPAIR_MAX_INCIDENT_HOURS", 36)
MAX_REPAIR_AGENT_USD_PER_DAY = env_float("PIPELINE_REPAIR_MAX_AGENT_USD_PER_DAY", 25.0)
MAX_REPAIR_AGENT_USD_PER_INCIDENT = env_float("PIPELINE_REPAIR_MAX_AGENT_USD_PER_INCIDENT", 12.0)
