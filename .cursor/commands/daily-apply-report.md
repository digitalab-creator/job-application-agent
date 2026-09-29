# daily-apply-report

**Business outcome:** Answer “Did we send today’s applications? If not, why?” without manual log diving.

Read-only audit of the live apply worker, ledgers, Docker logs, and n8n apply/discover runs for **today (Asia/Jerusalem)** unless a date is passed.

Root: `/opt/apps/job-application-agent`. Related n8n workflow: **Apply to jobs (daily)** `fcYSvcG7IiP8xAqr`.

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

1. Paste or summarize the script **Summary**, **What stopped progress**, and **Suggested next steps** sections.
2. Call out **confirmed submissions** vs **daily limit** first (that is the business answer).
3. Distinguish **attempts** (`JOB_OPENED` / CVs generated) from **confirmed** (`applications.jsonl` with `confirmationDetected`).
4. Do **not** print `.env`, tokens, or `Authorization` headers.
5. Do **not** trigger apply/discover webhooks unless the user asks.

## SSOT

Logic lives in `scripts/daily-apply-report.py`. Update the script when new blockers or metrics matter; keep this command as the runbook only.

## Related

- Manual apply + deep n8n audit: `/opt/apps/n8n/.cursor/commands/job-apply-run.md`
- Ship worker fixes: `.cursor/extensions/ship.md`
