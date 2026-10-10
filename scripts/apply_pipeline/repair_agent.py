from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from apply_pipeline.paths import ROOT

REPAIR_PROMPT_TEMPLATE = """You are repairing the job-application-agent pipeline in an isolated worktree.
Read the incident evidence JSON at {evidence_path}.
Rules:
- Minimal generalizable fix with regression tests.
- Never bypass submission ledger; no submit:true in tests.
- Do not change candidate identity facts or secrets.
- Commit on branch {branch} and summarize changes.
Evidence (truncated): {summary}
"""


def _cursor_agent_available() -> bool:
    try:
        subprocess.check_output(["cursor", "agent", "--version"], text=True, timeout=30)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


def run_repair_agent(
    evidence: dict[str, Any],
    branch: str,
    *,
    dry_run: bool = True,
    estimated_usd: float = 5.0,
) -> dict[str, Any]:
    """Run Cursor CLI agent in a disposable git worktree (no production checkout writes)."""
    if dry_run:
        return {
            "status": "skipped",
            "reason": "dry_run",
            "branch": branch,
            "estimated_usd": estimated_usd,
        }
    if not _cursor_agent_available():
        return {"status": "skipped", "reason": "cursor_agent_unavailable"}
    if not os.environ.get("CURSOR_API_KEY") and not os.environ.get("PIPELINE_REPAIR_ALLOW_LOCAL_AGENT"):
        return {"status": "skipped", "reason": "no_cursor_api_key"}

    worktrees = ROOT / "tmp" / "pipeline-repair-worktrees"
    worktrees.mkdir(parents=True, exist_ok=True)
    wt_dir = Path(tempfile.mkdtemp(prefix="repair-", dir=str(worktrees)))
    evidence_path = wt_dir / "incident-evidence.json"
    evidence_path.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    try:
        subprocess.check_call(
            ["git", "-C", str(ROOT), "worktree", "add", "-B", branch, str(wt_dir), "dev"],
            timeout=120,
        )
        summary = json.dumps(
            {
                "root_cause": evidence.get("classification", {}).get("root_cause"),
                "day": evidence.get("snapshot", {}).get("day"),
            }
        )[:2000]
        prompt = REPAIR_PROMPT_TEMPLATE.format(
            evidence_path=evidence_path,
            branch=branch,
            summary=summary,
        )
        subprocess.check_call(
            [
                "cursor",
                "agent",
                "-p",
                "--output-format",
                "json",
                prompt,
            ],
            cwd=str(wt_dir),
            timeout=3600,
            env={**os.environ, "CURSOR_AGENT": "1"},
        )
        return {"status": "completed", "worktree": str(wt_dir), "branch": branch, "estimated_usd": estimated_usd}
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
        return {"status": "failed", "error": str(err), "worktree": str(wt_dir), "branch": branch}
    finally:
        try:
            subprocess.call(
                ["git", "-C", str(ROOT), "worktree", "remove", "--force", str(wt_dir)],
                timeout=60,
            )
        except OSError:
            pass
        if wt_dir.exists():
            shutil.rmtree(wt_dir, ignore_errors=True)
