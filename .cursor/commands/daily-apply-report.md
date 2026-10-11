# daily-apply-report

**Business outcome:** Answer “Did we send today’s applications? If not, why?” without manual log diving.

Read-only audit of the live apply worker, ledgers, Docker logs, and (when `ORCHESTRATION_MODE=n8n`) n8n apply/discover runs for **today (Asia/Jerusalem)** unless a date is passed.

Root: `/opt/apps/job-application-agent` (only job product repo on this server). Native mode: use **scheduled_production** / native run logs; archived n8n workflow `fcYSvcG7IiP8xAqr` is inactive.

## Run (agent must execute)

```bash
python3 /opt/apps/job-application-agent/scripts/daily-apply-report.py
```

Optional historical day:

```bash
python3 /opt/apps/job-application-agent/scripts/daily-apply-report.py 2026-09-29
```

Exit code **0** = confirmed submissions met `DAILY_APPLY_LIMIT`; **1** = target not met (still print the full report).

## Report to the user

1. Paste or summarize the script **Summary**, **Attempt details (links & blockers)** when present, **Jobs tried (worker logs)**, **Apply attempts**, **What stopped progress**, and **Suggested next steps** sections.
2. Call out **confirmed submissions** vs **daily limit** first (that is the business answer).
3. Distinguish **attempts** (worker ledger rows + per-attempt table) from **confirmed** (`confirmationDetected`).
4. Use **Jobs tried** for per-opening exact causes (logs); use **ledger** only for quota-counted outcomes.
5. Explain **CV PDF folder count** vs ledger (extra PDFs = dry-run / manual preview / retries).
6. Do **not** print `.env`, tokens, or `Authorization` headers.
7. Do **not** trigger apply/discover webhooks unless the user asks.

## SSOT

Logic lives in `scripts/daily-apply-report.py`. Update the script when new blockers or metrics matter; keep this command as the runbook only.

## Related

- Job n8n workflow exports: `orchestration/n8n/workflows/auto-export/` (SSOT in this repo)
- Manual apply + deep n8n audit: `/opt/apps/n8n/.cursor/commands/job-apply-run.md` (shared n8n host until Phase 2 cutover)
- Ship worker fixes: `.cursor/extensions/ship.md`
