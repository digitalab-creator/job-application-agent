from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BusinessStatus:
    state: str
    exit_code: int
    reason: str

    def as_dict(self) -> dict[str, str | int]:
        return {"state": self.state, "exit_code": self.exit_code, "reason": self.reason}


def business_status_from_snapshot(snapshot: dict[str, Any]) -> BusinessStatus:
    """Machine-readable business outcome — never conflate script success with applications sent."""
    infra = bool(snapshot.get("infrastructure_failure"))
    insufficient = bool(snapshot.get("insufficient_evidence"))
    confirmed = int(snapshot.get("confirmed_count") or 0)
    target = int(snapshot.get("daily_target") or 0)

    if insufficient:
        return BusinessStatus(
            state="insufficient_evidence",
            exit_code=3,
            reason=str(snapshot.get("insufficient_evidence_reason") or "missing_ledgers_or_health"),
        )
    if infra:
        return BusinessStatus(
            state="infrastructure_failure",
            exit_code=2,
            reason="; ".join(snapshot.get("infrastructure_blockers") or ["worker_unhealthy"]),
        )
    if confirmed >= target:
        return BusinessStatus(
            state="target_met",
            exit_code=0,
            reason=f"confirmed={confirmed} target={target}",
        )
    return BusinessStatus(
        state="target_missed",
        exit_code=1,
        reason=f"confirmed={confirmed} target={target}",
    )
