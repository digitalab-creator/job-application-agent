from __future__ import annotations

import json
import subprocess
from typing import Any

from apply_pipeline.paths import ROOT

REPO = "digitalab-creator/job-application-agent"


def _gh_json(args: list[str]) -> Any:
    try:
        raw = subprocess.check_output(
            ["gh", *args, "--repo", REPO],
            text=True,
            timeout=60,
            cwd=str(ROOT),
        )
        return json.loads(raw) if raw.strip() else None
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError, subprocess.TimeoutExpired):
        return None


def origin_dev_sha() -> str | None:
    try:
        subprocess.check_call(
            ["git", "-C", str(ROOT), "fetch", "origin", "dev"],
            timeout=120,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return (
            subprocess.check_output(
                ["git", "-C", str(ROOT), "rev-parse", "origin/dev"],
                text=True,
                timeout=15,
            )
            .strip()[:40]
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return None


def open_prs_matching(keyword: str) -> list[dict[str, Any]]:
    data = _gh_json(["pr", "list", "--state", "open", "--json", "number,title,headRefName,url"])
    if not isinstance(data, list):
        return []
    needle = keyword.lower()
    return [pr for pr in data if needle in str(pr.get("title", "")).lower()]


def deployment_context(production_sha: str | None) -> dict[str, Any]:
    dev_sha = origin_dev_sha()
    ahead = None
    if production_sha and dev_sha:
        try:
            out = subprocess.check_output(
                [
                    "git",
                    "-C",
                    str(ROOT),
                    "rev-list",
                    "--count",
                    f"{production_sha}..{dev_sha}",
                ],
                text=True,
                timeout=15,
            ).strip()
            ahead = int(out)
        except (subprocess.CalledProcessError, ValueError, subprocess.TimeoutExpired):
            ahead = None
    return {
        "production_sha": production_sha,
        "origin_dev_sha": dev_sha,
        "commits_on_dev_not_in_production": ahead,
    }
