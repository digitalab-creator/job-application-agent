#!/usr/bin/env bash
# SSOT: block /ship when the frozen dev commit has no successful CI run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REPO="${GITHUB_REPO:-digitalab-creator/job-application-agent}"
SHA="${1:-}"
if [[ -z "$SHA" ]]; then
  SHA="$(git rev-parse origin/dev^{commit} 2>/dev/null || true)"
fi
if [[ -z "$SHA" ]]; then
  echo "verify-ci-green-for-sha: need a commit SHA or fetchable origin/dev"
  exit 1
fi

if [[ -f /opt/apps/n8n/scripts/load-github-token.sh ]]; then
  # shellcheck source=/dev/null
  source /opt/apps/n8n/scripts/load-github-token.sh
  load_server_github_token
fi

RUN_JSON="$(gh run list --repo "$REPO" --branch dev --commit "$SHA" --workflow CI --limit 5 \
  --json status,conclusion 2>/dev/null || echo '[]')"

python3 - "$SHA" "$RUN_JSON" <<'PY'
import json
import sys

sha, raw = sys.argv[1], sys.argv[2]
runs = json.loads(raw or "[]")
if not runs:
    print(f"verify-ci-green-for-sha: no CI workflow run found for {sha} on dev")
    raise SystemExit(1)
if any(r.get("status") != "completed" for r in runs):
    print(f"verify-ci-green-for-sha: CI still in progress for {sha}")
    raise SystemExit(1)
if not any(r.get("conclusion") in ("success", "skipped") for r in runs):
    bad = next((r.get("conclusion") for r in runs if r.get("conclusion") not in ("success", "skipped")), "unknown")
    print(f"verify-ci-green-for-sha: CI failed for {sha} (conclusion={bad})")
    raise SystemExit(1)
print(f"verify-ci-green-for-sha: CI green for {sha}")
PY
