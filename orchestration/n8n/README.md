# Archived n8n job workflows (inactive)

Job orchestration **merged here** from `dl-n8n`. Production uses **native** scheduling in `src/orchestration/` (`ORCHESTRATION_MODE=native`).

| Workflow ID | Name | `active` in export |
|-------------|------|--------------------|
| `fcYSvcG7IiP8xAqr` | Apply to jobs (daily) | `false` |
| `oreaKVjt7ifi0i6a` | Discover jobs (daily) | `false` |
| `Zp8gHnOtpApply01` | greenhouse-apply-otp | `false` |

**Do not** re-enable these on the shared n8n server for production. `dl-n8n` export excludes these IDs; SSOT is this folder only.

Scripts:

- `scripts/sync-workflows-to-live.sh` — push JSON to n8n (emergency / parity only)
- `scripts/deactivate-job-workflows.sh` — `CONFIRM=DEACTIVATE_N8N_JOB_WORKFLOWS`
- `scripts/delete-job-workflows-from-live-n8n.sh` — `CONFIRM=DELETE_N8N_JOB_WORKFLOWS` (removes live DB rows; JSON remains here)
