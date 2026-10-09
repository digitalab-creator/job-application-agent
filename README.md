# Job application worker

Discovery and apply run through **n8n** and this service (Google Sheet queue). The older **job-finder** Apps Script repo is legacy and not used in production.

## Search Config (targeting policy)

Native discover/apply loads the **`Search Config`** sheet tab on each run (same spreadsheet as the job tracker). ChatGPT/n8n automations should use the same `policy_version` and category weights — do not hard-code a tech/marketing split in workflows.

| Key | Example |
|-----|---------|
| `policy_version` | `2026-03-26-targeting-v1` |
| `discovery_min_match_score` | `70` |
| `discover_enabled` | `true` |
| `skip_discover_when_unresolved_gte` | `100` |

Category table (columns `Category` + `Share` as percent or decimal):

| Category | Share |
|----------|------:|
| Performance Marketing Leadership | 35 |
| Revenue Systems | 25 |
| Marketing Technology | 15 |
| AI Solutions | 10 |
| Applied AI | 10 |
| Analytics & CRO | 5 |

Discovery is skipped when **Review + Manual** row count is at or above `skip_discover_when_unresolved_gte` (finish the backlog before adding listings). Inspect active policy: `GET /search-policy` (Bearer `APPLY_API_TOKEN`).

This service opens a real job page, builds a CV from verified facts, fills the form, and submits only when you ask it to.

The two original PDFs in `data/cv/` are reference only. The file that gets uploaded is generated per job under `generated-cv/` and must pass LLM tailoring plus truth gates. If generation fails, the worker stops with `cv_generation_failed` and does not upload a generic resume.

Comeet’s “answer validation task” is anti-bot friction, not an LLM puzzle. A smarter model does not reliably pass it; expect `Review` and finish that step manually when it appears.

## Start

```bash
docker compose up -d --build
curl -s http://127.0.0.1:3099/health
```

`/health` fails if either baseline PDF is missing, Chromium cannot start, or the model key is missing.

## Preview a CV without applying

```bash
curl -s -X POST http://127.0.0.1:3099/cv/preview \
  -H "Authorization: Bearer $APPLY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"job":{"role":"Senior Backend Engineer - AI/ML Systems","company":"Stampli","url":"https://www.comeet.com/jobs/stampli/F6.007/senior-backend-engineer---aiml-systems/0B.273"}}'
```

## Fill a form without submitting

`"submit": false` uploads the CV and stops before the Submit button.

`"submit": true` clicks Submit once. A job is marked applied only when a confirmation message is visible. A second submit for the same URL is refused after a confirmation was recorded.
