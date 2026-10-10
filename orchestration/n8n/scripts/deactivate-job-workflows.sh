#!/usr/bin/env bash
# Turn off the three job workflows on the shared n8n server.
# Job runs belong to this repo's native scheduler. This does not touch other products.
set -euo pipefail

if [[ "${CONFIRM:-}" != "DEACTIVATE_N8N_JOB_WORKFLOWS" ]]; then
  echo "Refusing to deactivate. Re-run with CONFIRM=DEACTIVATE_N8N_JOB_WORKFLOWS" >&2
  exit 1
fi

ORCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${N8N_EXPORT_BASE_URL:-http://127.0.0.1:5678/api/v1}"
BASE_URL="${BASE_URL%/}"

load_env() {
  local env_file="${ORCHESTRATION_N8N_ENV:-/opt/apps/n8n/.env}"
  if [[ ! -f "$env_file" ]]; then
    echo "deactivate-job-workflows: no env file (set ORCHESTRATION_N8N_ENV)" >&2
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
  echo "deactivate-job-workflows: N8N_API_KEY missing" >&2
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

def api(method: str, path: str) -> dict:
    req = urllib.request.Request(
        f"{base_url}{path}",
        method=method,
        headers={"X-N8N-API-KEY": api_key, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else {}

for wid in ids:
    try:
        current = api("GET", f"/workflows/{wid}")
    except urllib.error.HTTPError as err:
        raise SystemExit(f"deactivate-job-workflows: GET {wid} failed HTTP {err.code}") from err
    name = current.get("name", wid)
    if current.get("active") is False:
        print(f"deactivate-job-workflows: already off {wid} ({name})")
        continue
    try:
        api("POST", f"/workflows/{wid}/deactivate")
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:300]
        raise SystemExit(f"deactivate-job-workflows: POST {wid} failed HTTP {err.code}: {detail}") from err
    print(f"deactivate-job-workflows: deactivated {wid} ({name})")
PY
