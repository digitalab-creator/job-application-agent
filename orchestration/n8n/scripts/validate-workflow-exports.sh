#!/usr/bin/env bash
# Validate exported job n8n workflow JSON under orchestration/n8n/workflows/auto-export/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ORCH_ROOT"

EXPORT_DIR="${WORKFLOW_EXPORT_DIR:-$ORCH_ROOT/workflows/auto-export}"
if [[ ! -d "$EXPORT_DIR" ]]; then
  echo "Missing export dir: $EXPORT_DIR"
  exit 1
fi

python3 - "$EXPORT_DIR" <<'PY'
import json
import sys
from pathlib import Path

export_dir = Path(sys.argv[1])
files = sorted(export_dir.glob("wf-*.json"))
if not files:
    print(f"No workflow exports in {export_dir}")
    raise SystemExit(1)

errors: list[str] = []
for path in files:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"{path.name}: invalid JSON ({exc})")
        continue
    for key in ("id", "name", "nodes", "connections"):
        if key not in data:
            errors.append(f"{path.name}: missing top-level {key!r}")
    nodes = data.get("nodes")
    if isinstance(nodes, list):
        for i, node in enumerate(nodes):
            if not isinstance(node, dict):
                errors.append(f"{path.name}: nodes[{i}] is not an object")
                continue
            if not node.get("name") or not node.get("type"):
                errors.append(f"{path.name}: nodes[{i}] missing name or type")
    active = data.get("activeVersion")
    if isinstance(active, dict) and "nodes" in active:
        live_by_name = {
            n.get("name"): n.get("parameters", {}).get("jsCode")
            for n in data.get("nodes", [])
            if n.get("type") == "n8n-nodes-base.code" and n.get("name")
        }
        active_by_name = {
            n.get("name"): n.get("parameters", {}).get("jsCode")
            for n in active.get("nodes", [])
            if n.get("type") == "n8n-nodes-base.code" and n.get("name")
        }
        for name, live_js in live_by_name.items():
            active_js = active_by_name.get(name)
            if active_js is not None and live_js != active_js:
                errors.append(f"{path.name}: Code node {name!r} differs between nodes and activeVersion")

if errors:
    print("Workflow export validation failed:")
    for line in errors:
        print(f"  - {line}")
    raise SystemExit(1)

print(f"Validated {len(files)} workflow export(s) in {export_dir}")
PY

for sh in "$SCRIPT_DIR"/*.sh; do
  [[ "$(basename "$sh")" == "$(basename "${BASH_SOURCE[0]}")" ]] && continue
  bash -n "$sh"
done
echo "Shell syntax OK for orchestration/n8n/scripts/*.sh"
