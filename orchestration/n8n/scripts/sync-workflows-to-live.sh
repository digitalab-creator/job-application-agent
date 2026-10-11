#!/usr/bin/env bash
# Push git-exported job workflows to the live n8n instance (PUT /workflows/:id).
# Production uses native orchestration; do not run on deploy unless SYNC_JOB_N8N_WORKFLOWS=1.
set -euo pipefail

if [[ "${SYNC_JOB_N8N_WORKFLOWS:-}" != "1" && "${CONFIRM:-}" != "SYNC_JOB_N8N_WORKFLOWS" ]]; then
  echo "sync-workflows-to-live: refused (set SYNC_JOB_N8N_WORKFLOWS=1 or CONFIRM=SYNC_JOB_N8N_WORKFLOWS)" >&2
  exit 1
fi

ORCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORT_DIR="${WORKFLOW_EXPORT_DIR:-$ORCH_ROOT/workflows/auto-export}"
BASE_URL="${N8N_EXPORT_BASE_URL:-http://127.0.0.1:5678/api/v1}"
BASE_URL="${BASE_URL%/}"

load_env() {
  local env_file="${ORCHESTRATION_N8N_ENV:-/opt/apps/n8n/.env}"
  if [[ ! -f "$env_file" && -f "$ORCH_ROOT/.env" ]]; then
    env_file="$ORCH_ROOT/.env"
  fi
  if [[ ! -f "$env_file" ]]; then
    echo "sync-workflows-to-live: no env file (set ORCHESTRATION_N8N_ENV)" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

load_env
API_KEY="${N8N_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "sync-workflows-to-live: N8N_API_KEY missing" >&2
  exit 1
fi

if [[ ! -d "$EXPORT_DIR" ]]; then
  echo "sync-workflows-to-live: missing $EXPORT_DIR" >&2
  exit 1
fi

python3 - "$EXPORT_DIR" "$BASE_URL" "$API_KEY" <<'PY'
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

export_dir = Path(sys.argv[1])
base_url = sys.argv[2].rstrip("/")
api_key = sys.argv[3]

ALLOWED_SETTINGS = {
    "executionOrder",
    "timezone",
    "saveDataErrorExecution",
    "saveDataSuccessExecution",
    "saveManualExecutions",
    "callerPolicy",
    "errorWorkflow",
    "availableInMCP",
}


def put_payload(wf: dict) -> dict:
    payload = {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": {k: v for k, v in wf.get("settings", {}).items() if k in ALLOWED_SETTINGS},
    }
    if "staticData" in wf:
        payload["staticData"] = wf["staticData"]
    return payload


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = None
    headers = {"X-N8N-API-KEY": api_key, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{base_url}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else {}


files = sorted(export_dir.glob("wf-*.json"))
if not files:
    raise SystemExit(f"sync-workflows-to-live: no exports in {export_dir}")

for path in files:
    wf = json.loads(path.read_text(encoding="utf-8"))
    wid = wf.get("id") or path.stem.removeprefix("wf-")
    payload = put_payload(wf)
    try:
        api("PUT", f"/workflows/{wid}", payload)
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:500]
        raise SystemExit(f"sync-workflows-to-live: PUT {wid} failed HTTP {err.code}: {detail}") from err
    print(f"sync-workflows-to-live: updated {wid} ({wf.get('name', path.name)})")

print(f"sync-workflows-to-live: synced {len(files)} workflow(s)")
PY
