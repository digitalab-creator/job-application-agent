# fix-apply-review-row

**Business outcome:** Turn one stuck **Review** sheet row into either a **working auto-apply** or a clear **won’t-fix** with evidence—without manual log spelunking.

Root: `/opt/apps/job-application-agent`. Apply workflow: **Apply to jobs (daily)** `fcYSvcG7IiP8xAqr`.

## 1. Triage (agent must run first)

```bash
python3 /opt/apps/job-application-agent/scripts/triage-review-row.py --code-fixable-only
```

Default behavior:

- **Skips** non-code blockers: `captcha`, `login_required`, `already_submitted` (plus worker-log captcha).
- **HTTP live-check** each candidate URL (follows redirects). **Skips dead links only:**
  - **`NOT_FOUND`** — 404 / “page not found” in hero (same rules as `classify-page.ts`).
  - **`CLOSED`** — posting removed / no longer accepting.
- **Does not skip** general careers/list pages — those stay **code-fixable** (`pick-opening.ts` / `careers_page`); the worker picks the best matching job at apply time.

Optional:

```bash
python3 /opt/apps/job-application-agent/scripts/triage-review-row.py --row 518
python3 /opt/apps/job-application-agent/scripts/triage-review-row.py --url payoneer
python3 /opt/apps/job-application-agent/scripts/triage-review-row.py --json --code-fixable-only
python3 /opt/apps/job-application-agent/scripts/triage-review-row.py --include-non-fixable
python3 /opt/apps/job-application-agent/scripts/triage-review-row.py --no-live-check
```

Paste for the user: **row, job link, blocker, live URL status**, sheet notes, and **likely code area**. Do **not** print tokens or full `.env`.

## 2. Classify the failure

| Blocker | Usually fixable in code? | Where to look |
|--------|---------------------------|---------------|
| `navigation_failed` | Yes | `job-navigation-url.ts`, `openJob()` in `apply-job.ts`, `server.ts` (no 500 on apply) |
| `cv_upload_failed` | Yes | `form-filler.ts` (iframe wait, file inputs), `revealApplyForm()` |
| `form_validation` / `VALIDATION_FAILED` logs | Yes | `form-filler.ts`, `field-map.ts`, `media-answers.ts` |
| `missing_fact` / `REVIEW_REQUIRED` | Often yes | `field-map.ts`, `facts.ts`, `answer-question.ts` |
| `form_not_detected` | Often yes | `revealApplyForm()`, `applyFormScope()`, `classify-page.ts` |
| `careers_page` / `no_matching_opening` | Sometimes | `pick-opening.ts`, job URL on sheet |
| `email_verification_required` | Yes (n8n Gmail OTP) | `greenhouse-otp-fetch.ts`, n8n `greenhouse-apply-otp`, `enterGreenhouseSecurityCode()` |
| `submit_not_accepted` | Diagnose first | `greenhouse-post-submit.ts` — form still shows Submit application (often invisible reCAPTCHA) |
| `captcha` | No (manual) | Report; status **`manual_required`** → sheet **Manual** |
| `login_required` | No (v1) | Report; status **`manual_required`** → sheet **Manual** |
| `cv_generation_failed` | Yes | `cv/generate.ts`, `cv/validate.ts` |
| `already_submitted` | No | Ledger / duplicate URL |
| Live **`NOT_FOUND` / `CLOSED`** | No | Sheet **Closed**; fix discover URL — not worker code |

If logs show `REQUEST_FAILED` / redirect errors, treat as **navigation_failed** even when the sheet still says `New`.

## 3. Fix loop (code changes only when classification says yes)

1. **Reproduce** with dry-run first:

   ```bash
   TOKEN=$(grep '^APPLY_API_TOKEN=' /opt/apps/job-application-agent/.env | cut -d= -f2-)
   curl -s -X POST http://127.0.0.1:3099/apply \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"submit":false,"ignoreLedger":true,"row":ROW,"job":{"company":"…","role":"…","url":"…"}}'
   ```

2. **Implement** the smallest fix in this repo (match existing patterns; add/adjust unit tests when logic is pure).

3. **Verify locally:**

   ```bash
   cd /opt/apps/job-application-agent && docker compose build job-application-agent && docker compose up -d job-application-agent
   ```

   Re-run the same `curl` dry-run. Success = prior blocker cleared, or `blocker=dry_run` with form filled + CV attached, or honest terminal outcome (`closed`, `not_relevant`).

4. **Real apply (required when step 3 succeeded and ye have not already submitted this row in this fix session):**

   ```bash
   curl -s -X POST http://127.0.0.1:3099/apply \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"submit":true,"ignoreLedger":true,"row":ROW,"job":{"company":"…","role":"…","url":"…"}}'
   ```

   Skip real submit when dry-run returned `closed`, `manual_required`, captcha/login blockers, live **`NOT_FOUND`/`CLOSED`**, or the same blocker as before.

5. **Tell the user:** job link, what broke, what changed, dry-run result, and real apply result if run.

   Real apply (`submit: true` + `row`) updates the Google Sheet from the worker (`executeApply` → `syncApplyOutcomeToJobSheet`). Dry-run does **not** touch the sheet.

6. **Do not** run `/ship` or n8n apply webhooks unless the user requests it.

## 4. When not to code

- **404 / closed posting** (live check or worker `closed`) → sheet **Closed**; fix discover URL.
- One-off site outage or geo block → explain; leave row on **Review** if probe failed.
- Captcha / login / account gate → **Manual** (`manual_required`), not Review.
- Careers **list** URL → not dead; improve `pick-opening` or sheet deep link if `careers_page` / `no_matching_opening`.

## SSOT

- Triage + live probe: `scripts/triage-review-row.py` (hero rules mirror `classify-page.ts`).
- This file: runbook only.

## Related

- Pipeline overview: `daily-apply-report` command
- Deploy after merge: `.cursor/extensions/ship.md`
