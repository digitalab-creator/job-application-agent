# Recovery-mode targeting audit (2026-10-12)

## Evidence from tracker and Gmail
The tracker contains 608 job rows; 374 were labeled Applied AI, 102 Performance Leadership, 58 AI Solutions, 48 Marketing Technology, 17 Revenue Systems, and nine Analytics/CRO. Seventy-five rows were marked Applied, 30 had dates, and two were marked Interview. Email showed more interview processes (including AllCloud), so sheet statuses are **not** verified funnel conversions.

## Findings
- A broad discovery score at title/snippet level was regularly overconfident: actual rejection emails included jobs previously scored 95–97. Apply-time fit gates already inspect full JDs and verified candidate facts. Preserve them.
- The generator already uses LLM CV tailoring, explicit verified fact IDs, unsupported-claim audits, output schema, persona choices, relevance checks, and PDF quality checks. **Do not replace this stack with a static resume**.
- Marketing Technology was incorrectly assigned to the technology half of the queue for reporting/mix purposes despite being a hybrid CV identity and a commercial growth career category. Fixed queue-side classification; CV identity stays hybrid.
- The apply picker previously allocated a 20-item category mix and **only afterward truncated** to the smaller daily budget/pick cap, which can bias the resulting subset. Allocation now takes the actual cap.
- Search Config was a source of truth, so changes to compiled fallback weights alone would not reliably control live mix. Added opt-in `career_focus_mode=recovery` that selects 45% performance (including Analytics/CRO), 35% revenue + MarTech, 20% Applied AI + AI Solutions. Other workspaces remain balanced.
- Category mix defines effort allocation, **not predicted interview probabilities**. Scarce eligible categories backfill opportunistically.
- An existing mandatory full-JD evidence gate rejects unsupported must-haves. No broad exclusion of AI roles is appropriate; niche CV/research/Staff jobs should be screened on actual evidence, not just a high discovery score.

## CV audit remaining
- The baseline PDFs in `data/cv` are reference inputs, while live generated PDFs come from `src/profile/facts.ts`, `src/cv/generate.ts`, and `src/cv/validate.ts`. Verify factual consistency with actual employment dates. In the repository `roles`, Boroda is `2022–2024`; multiple Drive versions use `2022–2025`, some inconsistent. Do not silently overwrite.
- `profile/facts.ts` contains several numerical outcomes (customer volume, cost savings) that merit candidate/source corroboration, not a model-asserted verified flag.
- Prior marketing CV contained mathematically impossible 'reduced CPA by 300%'. The generated-CV fact catalog and number truth gate should prevent unsupported variants, but inspect sample outputs before rollout.
- CV `leadIdentity` is derived from tracker category even if later job fit chooses another persona; this can create a technical-led headline for a role whose JD truly requires performance skills. Follow-up change should use *full-JD role family* for final lead identity, with explicit truth gating. Do not remove CV validation to achieve it.
- LLM relevance has broad phrase-equivalence shortcuts ('large-scale' vs 'microservice') that may increase false positives; improve evidence specificity through benchmark fixtures before changing thresholds globally.
- Never send job applications simply because the role is in a preferred category. Maintain verified application confirmations and anti-duplicate ledger.

## Rollout
1. PR against `dev`, run `npm ci && npm run build && npm test`; preview generated CVs from each career lane and check role/date/metric attribution.
2. Merge+deploy to activate the opt-in config (not deployed by this PR).
3. In this user's tracker, set `Search Config` key `career_focus_mode=recovery`; reconfirm via `GET /search-policy`.
4. Inspect 20 actual **employer-confirmed** applications by lane and measure screening/interview rates. Review after two weeks instead of dynamically chasing every rejection.
5. Preserve all existing tracker rows, statuses, application ledgers, CV outputs, and historical automation logs.
