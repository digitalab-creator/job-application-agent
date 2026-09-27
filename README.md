# Job application worker

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
