# repair-apply-pipeline

**Business outcome:** When confirmed applications stall, gather evidence, classify root cause, and either recover safely or prepare a bounded code fix (PR) — without unattended real submissions.

Root: `/opt/apps/job-application-agent`. SSOT: `scripts/repair-apply-pipeline.py` + `scripts/apply_pipeline/`.

## Investigate (read-only — run first)

```bash
python3 /opt/apps/job-application-agent/scripts/repair-apply-pipeline.py --read-only --json
```

Historical day (Asia/Jerusalem):

```bash
python3 /opt/apps/job-application-agent/scripts/repair-apply-pipeline.py --day 2026-10-07 --read-only
```

Paste for the user: **business status**, **root cause**, **earliest failing stage**, **repair decision**, dominant blockers, queue depth. Do **not** print `.env` or tokens.

## Full repair (bounded)

Only when limits allow (cooldowns, max repairs/day, one active incident per fingerprint):

```bash
python3 /opt/apps/job-application-agent/scripts/repair-apply-pipeline.py --json
```

- **Tier A:** operational recovery only when policy allows (e.g. discover refresh).
- **Tier B:** isolated git worktree + Cursor CLI agent → branch `repair/inc-*` → PR (no auto-merge to `dev`).
- **Tier C:** stop with PR / manual approval (identity, ledger, auth, migrations).

Never `submit:true` or `ignoreLedger:true` in unattended repair.

## Automatic trigger

Native daily pipeline spawns `scripts/maybe-trigger-pipeline-repair.py --spawn` when target not met (`PIPELINE_REPAIR_AUTO_TRIGGER=false` disables).

## Post-deploy business check

```bash
python3 /opt/apps/job-application-agent/scripts/repair-apply-pipeline.py --verify-deploy "$SHA" --json
```

Green CI ≠ confirmed applications. Track `confirmed_applications_after_fix` separately.

## Related

- Daily KPIs: `daily-apply-report` (`--json` for machine contract)
- One Review row: `fix-apply-review-row`
- Ship (human authorized): `.cursor/extensions/ship.md`
- Bug patterns: `docs/bug-patterns/BUG_PATTERNS.md` + `bug-pattern-log` skill
