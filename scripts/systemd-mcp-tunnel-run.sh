#!/usr/bin/env bash
# systemd ExecStart — no doctor; long-running tunnel-client only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="${ROOT}/bin/tunnel-client-dist/tunnel-client"
CONFIG="${TUNNEL_CLIENT_CONFIG:-${ROOT}/deploy/tunnel-client/jobagent-mcp.yaml}"

if [[ ! -x "$TC" ]]; then
  echo "Missing tunnel-client at $TC"
  exit 1
fi

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(CONTROL_PLANE_API_KEY|JOBAGENT_MCP_ACCESS_TOKEN)=' "${ROOT}/.env" || true)
  set +a
fi

if [[ -z "${CONTROL_PLANE_API_KEY:-}" ]]; then
  echo "CONTROL_PLANE_API_KEY missing in ${ROOT}/.env"
  exit 1
fi

if [[ -z "${JOBAGENT_MCP_ACCESS_TOKEN:-}" ]]; then
  echo "JOBAGENT_MCP_ACCESS_TOKEN missing in ${ROOT}/.env"
  exit 1
fi

# ChatGPT tunnel discovery does not forward plugin Bearer to localhost; inject upstream auth here.
export JOBAGENT_MCP_BEARER="Bearer ${JOBAGENT_MCP_ACCESS_TOKEN}"
export MCP_EXTRA_HEADERS="Authorization: env:JOBAGENT_MCP_BEARER"
export MCP_DISCOVERY_EXTRA_HEADERS="Authorization: env:JOBAGENT_MCP_BEARER"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing tunnel config at $CONFIG"
  exit 1
fi

exec "$TC" run --config "$CONFIG"
