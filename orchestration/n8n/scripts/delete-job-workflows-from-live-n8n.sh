#!/usr/bin/env bash
# Delete the three job workflows from the shared n8n database.
# Exports in this repo remain the archive. Does not touch other products' workflows.
set -euo pipefail

if [[ "${CONFIRM:-}" != "DELETE_N8N_JOB_WORKFLOWS" ]]; then
  echo "Refusing to delete. Re-run with CONFIRM=DELETE_N8N_JOB_WORKFLOWS" >&2
  exit 1
fi

BASE_URL="${N8N_EXPORT_BASE_URL:-http://127.0.0.1:5678/api/v1}"
BASE_URL="${BASE_URL%/}"

load_env() {
  local env_file="${ORCHESTRATION_N8N_ENV:-/opt/apps/n8n/.env}"
  if [[ ! -f "$env_file" ]]; then
    echo "delete-job-workflows: no env file (set ORCHESTRATION_N8N_ENV)" >&2
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
  echo "delete-job-workflows: N8N_API_KEY missing" >&2
  exit 1
fi

python3 - "$BASE_URL" "$API_KEY" <<'PY'
import json
import sys
import urllib.error
import urllib.request

base_url = sys.argv[1].rstrip("/")
api_key = sys.argv[2]
ids = ["fcYSvcG7IiP8xAqr", "oreaKVjt7ifi0i6a", "Zp8gHnOtpApply01"]

def api(method: str, path: str) -> None:
    req = urllib.request.Request(
        f"{base_url}{path}",
        method=method,
        headers={"X-N8N-API-KEY": api_key, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return
        detail = err.read().decode()[:300]
        raise SystemExit(f"delete-job-workflows: {method} {path} HTTP {err.code}: {detail}") from err

for wid in ids:
    try:
        get_req = urllib.request.Request(
            f"{base_url}/workflows/{wid}",
            headers={"X-N8N-API-KEY": api_key, "Accept": "application/json"},
        )
        with urllib.request.urlopen(get_req, timeout=60) as resp:
            current = json.loads(resp.read().decode())
        name = current.get("name", wid)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            print(f"delete-job-workflows: already absent {wid}")
            continue
        raise
    if current.get("active"):
        api("POST", f"/workflows/{wid}/deactivate")
    api("DELETE", f"/workflows/{wid}")
    print(f"delete-job-workflows: deleted {wid} ({name})")
PY
