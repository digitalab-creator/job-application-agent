#!/usr/bin/env bash
# Export job-product n8n workflows to orchestration/n8n/workflows/auto-export/.
#
# Env:
#   SKIP_WORKFLOW_EXPORT=1  — exit immediately (no network).
#   ORCHESTRATION_N8N_ENV     — .env with N8N_API_KEY (default: /opt/apps/n8n/.env)
#   N8N_EXPORT_BASE_URL       — default http://127.0.0.1:5678/api/v1

set -euo pipefail

ORCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_ROOT="$(cd "$ORCH_ROOT/../.." && pwd)"
OUT_DIR="${WORKFLOW_EXPORT_DIR:-$ORCH_ROOT/workflows/auto-export}"
BASE_URL="${N8N_EXPORT_BASE_URL:-http://127.0.0.1:5678/api/v1}"
BASE_URL="${BASE_URL%/}"

JOB_IDS=(fcYSvcG7IiP8xAqr oreaKVjt7ifi0i6a Zp8gHnOtpApply01)

load_env() {
  local env_file="${ORCHESTRATION_N8N_ENV:-/opt/apps/n8n/.env}"
  if [[ ! -f "$env_file" && -f "$ORCH_ROOT/.env" ]]; then
    env_file="$ORCH_ROOT/.env"
  fi
  [[ -f "$env_file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

if [[ "${SKIP_WORKFLOW_EXPORT:-}" == "1" ]]; then
  echo "export-n8n-workflows: SKIP_WORKFLOW_EXPORT=1, skipping."
  exit 0
fi

load_env

API_KEY="${N8N_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "export-n8n-workflows: N8N_API_KEY not set — skipping." >&2
  exit 0
fi

command -v jq >/dev/null 2>&1 || {
  echo "export-n8n-workflows: jq is required." >&2
  exit 1
}

mkdir -p "$OUT_DIR"

for wid in "${JOB_IDS[@]}"; do
  if ! wf="$(curl -sS -f -H "X-N8N-API-KEY: ${API_KEY}" -H "Accept: application/json" "${BASE_URL}/workflows/${wid}")"; then
    echo "export-n8n-workflows: failed to fetch workflow ${wid} from ${BASE_URL}." >&2
    exit 1
  fi
  echo "$wf" | jq '.' >"${OUT_DIR}/wf-${wid}.json"
done

shopt -s nullglob
for f in "${OUT_DIR}"/wf-*.json; do
  base="$(basename "$f" .json)"
  id="${base#wf-}"
  keep=0
  for wid in "${JOB_IDS[@]}"; do
    if [[ "$id" == "$wid" ]]; then
      keep=1
      break
    fi
  done
  if [[ "$keep" != "1" ]]; then
    rm -f "$f"
    echo "export-n8n-workflows: removed non-job export $(basename "$f")"
  fi
done
shopt -u nullglob

echo "export-n8n-workflows: wrote ${#JOB_IDS[@]} job workflow(s) under ${OUT_DIR/#$AGENT_ROOT/}"

if [[ "${FROM_GIT_HOOK:-}" == "1" ]] && [[ "${NO_GIT_ADD:-}" != "1" ]]; then
  if git -C "$AGENT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$AGENT_ROOT" add -- "$OUT_DIR"
  fi
fi

exit 0
