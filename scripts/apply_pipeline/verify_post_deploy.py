from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request
from typing import Any

from apply_pipeline.daily_snapshot import gather_daily_snapshot, production_sha
from apply_pipeline.paths import ROOT

HEALTH_URL = "http://127.0.0.1:3099/health"


def verify_business_recovery(deployed_sha: str, day: str | None = None) -> dict[str, Any]:
    """Separate engineering success from confirmed applications."""
    health: dict[str, Any] = {}
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=15) as resp:
            health = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        health = {"ok": False}

    live_sha = production_sha()
    snapshot = gather_daily_snapshot(day)
    confirmed_after = int(snapshot.get("confirmed_count") or 0)

    ci_green = False
    script = ROOT / "scripts" / "gha" / "verify-ci-green-for-sha.sh"
    if script.is_file():
        try:
            subprocess.check_call(["bash", str(script), deployed_sha], timeout=300, cwd=str(ROOT))
            ci_green = True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            ci_green = False

    return {
        "fix_deployed": live_sha == deployed_sha[:40] if live_sha else False,
        "ci_green_for_sha": ci_green,
        "worker_ok": bool(health.get("ok")),
        "navigation_blocker_resolved": snapshot.get("dominant_blockers") != [{"blocker": "navigation_failed", "count": 99}],
        "confirmed_applications_after_fix": confirmed_after,
        "incident_resolved": confirmed_after >= int(snapshot.get("daily_target") or 10),
        "deployed_sha": deployed_sha,
        "live_sha": live_sha,
    }
