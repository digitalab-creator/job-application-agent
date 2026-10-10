# Bug patterns (batch 001)

Rolling batch file — see skill `bug-pattern-log` and `/archive-full-bug-pattern`.

**Format:** `YYYY-MM-DD | env | area | symptom | root_cause | fix_or_lesson`

## Stats

<!-- bug-pattern-stats:start -->
| | |
|---|---|
| **Batch** | 001 (`BUG_PATTERNS.md`) |
| **Unreviewed** | 0 / 50 |
| **Review at** | 50 (50 remaining) |
| **Date range** | — |
| **Last updated** | 2026-09-28 |
| **Hotspot** | — |

**By env:** —

**By area:** —

**By root-cause family:** —
<!-- bug-pattern-stats:end -->

<!-- entries below -->
2026-10-10 | prod | apply/reporting | daily-apply-report exit 0 with 0 confirmed | script returned 0 unless infra blockers; ignored DAILY_CONFIRMED target | business_status JSON + exit 1 target_missed; trigger repair via apply_pipeline
