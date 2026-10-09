#!/usr/bin/env bash
# Catch drift between worker queue-mix SSOT and n8n Pick Jobs Code node defaults.
set -euo pipefail

ORCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_ROOT="$(cd "$ORCH_ROOT/../.." && pwd)"
WF="$ORCH_ROOT/workflows/auto-export/wf-fcYSvcG7IiP8xAqr.json"
QM="$AGENT_ROOT/src/discovery/queue-mix.ts"

if [[ ! -f "$WF" || ! -f "$QM" ]]; then
  echo "check-pick-jobs-constants: missing workflow export or queue-mix.ts" >&2
  exit 1
fi

python3 - "$WF" "$QM" <<'PY'
import json
import re
import sys
from pathlib import Path

wf_path = Path(sys.argv[1])
qm_path = Path(sys.argv[2])

wf = json.loads(wf_path.read_text(encoding="utf-8"))
pick = next(
    (n for n in wf.get("nodes", []) if n.get("name") == "Pick Jobs" and n.get("type") == "n8n-nodes-base.code"),
    None,
)
if not pick:
    raise SystemExit("check-pick-jobs-constants: Pick Jobs code node not found")

js = pick.get("parameters", {}).get("jsCode") or ""
qm = qm_path.read_text(encoding="utf-8")

def ts_const(name: str) -> int | None:
    m = re.search(rf"export const {name}\s*=\s*(\d+)", qm)
    return int(m.group(1)) if m else None

def ts_share_default() -> float | None:
    m = re.search(r"export const QUEUE_MIX_MARKETING_SHARE_DEFAULT\s*=\s*([\d.]+)", qm)
    return float(m.group(1)) if m else None

batch = ts_const("DAILY_APPLY_BATCH_LIMIT")
tech = ts_const("DAILY_APPLY_TECH_TARGET")
mkt = ts_const("DAILY_APPLY_MARKETING_TARGET")
share_default = ts_share_default()
if batch is None or tech is None or mkt is None or share_default is None:
    raise SystemExit("check-pick-jobs-constants: could not read queue-mix constants")

errors: list[str] = []
if f"dailyPickLimit ?? policy.maxAttempts ?? {batch}" not in js and f"?? {batch}" not in js:
    if str(batch) not in js:
        errors.append(f"n8n Pick Jobs should default attempt cap to {batch} (DAILY_APPLY_BATCH_LIMIT)")

expected_mkt = round(batch * share_default)
expected_tech = batch - expected_mkt
if expected_mkt != mkt or expected_tech != tech:
    errors.append(
        f"queue-mix targets ({tech} tech / {mkt} mkt) differ from default share split ({expected_tech}/{expected_mkt})"
    )

if "/queue/pick" not in js:
    errors.append("n8n Pick Jobs should POST to worker /queue/pick (mix owned by queue-mix.ts)")

if errors:
    print("check-pick-jobs-constants failed:")
    for line in errors:
        print(f"  - {line}")
    raise SystemExit(1)

print(
    f"check-pick-jobs-constants: OK (batch={batch}, tech={tech}, marketing={mkt}, share_default={share_default})"
)
PY
