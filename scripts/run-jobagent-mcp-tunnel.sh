#!/usr/bin/env bash
# Step 2: Secure MCP Tunnel → local jobagent-mcp-gateway (http://127.0.0.1:3101/mcp)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="${ROOT}/bin/tunnel-client-dist/tunnel-client"
PROFILE="${TUNNEL_CLIENT_PROFILE:-jobagent-mcp}"
TUNNEL_ID="${CONTROL_PLANE_TUNNEL_ID:?Set CONTROL_PLANE_TUNNEL_ID in .env}"

if [[ ! -x "$TC" ]]; then
  echo "Missing tunnel-client at $TC — see docs/planning/CHATGPT_MCP_INTEGRATION.md"
  exit 1
fi

if [[ -f "${ROOT}/.env" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^(CONTROL_PLANE_API_KEY|JOBAGENT_MCP_ACCESS_TOKEN)=' "${ROOT}/.env" || true)
  set +a
fi

if [[ -z "${JOBAGENT_MCP_ACCESS_TOKEN:-}" ]]; then
  echo "Set JOBAGENT_MCP_ACCESS_TOKEN in ${ROOT}/.env (gateway Bearer token)."
  exit 1
fi

export JOBAGENT_MCP_BEARER="Bearer ${JOBAGENT_MCP_ACCESS_TOKEN}"
export MCP_EXTRA_HEADERS="Authorization: env:JOBAGENT_MCP_BEARER"
export MCP_DISCOVERY_EXTRA_HEADERS="Authorization: env:JOBAGENT_MCP_BEARER"

if [[ -z "${CONTROL_PLANE_API_KEY:-}" ]]; then
  echo "Set CONTROL_PLANE_API_KEY in ${ROOT}/.env (Runtime API key from Platform → API keys)."
  echo "Tunnel id: ${TUNNEL_ID}"
  exit 1
fi

export CONTROL_PLANE_TUNNEL_ID="$TUNNEL_ID"

echo "Checking MCP gateway..."
curl -fsS "http://127.0.0.1:3101/healthz" >/dev/null || {
  echo "Start gateway first: docker compose --profile mcp up -d jobagent-mcp-gateway"
  exit 1
}

"$TC" doctor --profile "$PROFILE" --explain
exec "$TC" run --profile "$PROFILE"
