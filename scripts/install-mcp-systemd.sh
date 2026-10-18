#!/usr/bin/env bash
# Install and enable MCP gateway + tunnel systemd units (run on the prod host as root).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="/etc/systemd/system"

install -m 0644 "${ROOT}/deploy/systemd/jobagent-mcp-gateway.service" "${UNIT_DIR}/jobagent-mcp-gateway.service"
install -m 0644 "${ROOT}/deploy/systemd/jobagent-mcp-tunnel.service" "${UNIT_DIR}/jobagent-mcp-tunnel.service"
chmod +x "${ROOT}/scripts/systemd-mcp-tunnel-run.sh"

systemctl daemon-reload
systemctl enable jobagent-mcp-gateway.service jobagent-mcp-tunnel.service
systemctl restart jobagent-mcp-gateway.service
systemctl restart jobagent-mcp-tunnel.service

systemctl --no-pager status jobagent-mcp-gateway.service jobagent-mcp-tunnel.service
