#!/usr/bin/env bash
# Server SSOT: /opt/apps/n8n/.env (GITHUB_TOKEN). Do not duplicate the token in this app's .env.
# Usage:
#   source scripts/load-github-token.sh
#   load_server_github_token

set -euo pipefail

_N8N_LOADER="/opt/apps/n8n/scripts/load-github-token.sh"
if [[ ! -f "$_N8N_LOADER" ]]; then
  echo "Missing $_N8N_LOADER — cannot load GITHUB_TOKEN" >&2
  return 1 2>/dev/null || exit 1
fi
# shellcheck disable=SC1090
source "$_N8N_LOADER"
load_server_github_token
