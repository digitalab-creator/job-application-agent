# bug-pattern-log extension (job-application-agent)

Root: `/opt/apps/job-application-agent`. Active batch dir: `docs/bug-patterns/` (`planning.bug_patterns_dir`).

## When to append

After a verified root-cause fix on the same artifact, with a reusable lesson (not one-off entity patches). Kit skill: **`bug-pattern-log`**.

Typical **area** values: `discovery`, `apply`, `browser`, `cv`, `quota`, `ledger`, `n8n-handoff`.

## Where to write

1. Resolve the active batch file (batch 001 = `BUG_PATTERNS.md` until it has 50 entry lines).
2. Append one line: `YYYY-MM-DD | env | area | symptom | root_cause | fix_or_lesson`
3. Refresh the stats block in that same file.

## Archive

Human-only: `/archive-full-bug-pattern` — never auto-archive when a batch hits 50.
