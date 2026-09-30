#!/usr/bin/env bash
# Dry-run stuck Review rows against live worker (requires APPLY_API_TOKEN in .env).
set -euo pipefail
ROOT="/opt/apps/job-application-agent"
TOKEN=$(grep '^APPLY_API_TOKEN=' "$ROOT/.env" | cut -d= -f2-)
BASE="http://127.0.0.1:3099/apply"

run_row() {
  local row="$1" company="$2" role="$3" url="$4"
  echo "=== row $row | $company ==="
  resp=$(curl -s -X POST "$BASE" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"submit\":false,\"ignoreLedger\":true,\"row\":$row,\"job\":{\"company\":\"$company\",\"role\":\"$role\",\"url\":\"$url\"}}")
  python3 -c "import json,sys; d=json.load(sys.stdin); print('status:',d.get('status'),'blocker:',d.get('blocker')); print((d.get('notes') or '')[:350])" <<<"$resp"
  echo
}

run_row 496 "PepsiCo / SodaStream" "Digital Growth & Analytics Marketing Sr. Director" "https://www.pepsicojobs.com/main/jobs/456938?lang=en-us"
run_row 279 "Payoneer" "Senior Product Manager, Onboarding - Growth" "https://www.payoneer.com/careers/position/8156113/?gh_jid=8156113"
run_row 188 "Wix" "Full Stack AI Engineer" "https://careers.wix.com/location/tel-aviv/positions/10022791"
run_row 367 "Riskified" "Product Lead" "https://www.riskified.com/job-description/?gh_jid=8785421002"
run_row 523 "Axonius" "Senior Cyber Data Analyst" "https://www.axonius.com/company/careers/open-jobs?gh_jid=7995553003"
run_row 478 "Majestic Labs" "LLM Inference Engineer" "https://www.comeet.com/jobs/majesticlabs/AA.004"
run_row 416 "Tastewise" "Senior AI Product Manager" "https://www.comeet.com/jobs/tastewise/F8.000/senior-ai-product-manager/0F.078"
