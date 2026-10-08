"""Paths and env for job-product n8n orchestration (SSOT: orchestration/n8n/)."""

from __future__ import annotations

import os
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[1]
ORCH_N8N_ROOT = AGENT_ROOT / "orchestration" / "n8n"
WORKFLOW_EXPORT_DIR = ORCH_N8N_ROOT / "workflows" / "auto-export"

JOB_WORKFLOW_IDS: tuple[str, ...] = (
    "fcYSvcG7IiP8xAqr",
    "oreaKVjt7ifi0i6a",
    "Zp8gHnOtpApply01",
)

LEGACY_N8N_ENV = Path("/opt/apps/n8n/.env")
N8N_API_BASE = os.environ.get("N8N_EXPORT_BASE_URL", "http://127.0.0.1:5678/api/v1").rstrip("/")


def n8n_env_file() -> Path:
    override = os.environ.get("ORCHESTRATION_N8N_ENV", "").strip()
    if override:
        return Path(override)
    if LEGACY_N8N_ENV.is_file():
        return LEGACY_N8N_ENV
    local = ORCH_N8N_ROOT / ".env"
    return local


def read_n8n_api_key() -> str:
    env_path = n8n_env_file()
    if not env_path.is_file():
        raise SystemExit(f"missing n8n env file: {env_path} (set ORCHESTRATION_N8N_ENV)")
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("N8N_API_KEY="):
            key = line.split("=", 1)[1].strip()
            if key:
                return key
    raise SystemExit(f"N8N_API_KEY not set in {env_path}")
