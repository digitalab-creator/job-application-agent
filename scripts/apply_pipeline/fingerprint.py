from __future__ import annotations

import hashlib
import json
from typing import Any


def incident_fingerprint(snapshot: dict[str, Any], classification: dict[str, Any]) -> str:
    """Stable id for dedup — one active repair per root cause + stage + dominant blocker."""
    blockers = snapshot.get("dominant_blockers") or []
    top = blockers[0]["blocker"] if blockers else "none"
    payload = {
        "root": classification.get("root_cause"),
        "stage": classification.get("earliest_failing_stage"),
        "top_blocker": top,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]
