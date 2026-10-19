import fs from "node:fs";
import type { BrowserContext, Page } from "playwright";
import { env } from "../config/env.js";
import { classifyJobPage, isLoginWallUrl } from "../application/classify-page.js";
import { applyFormScope, fillFields, pageHasDeepEmailInput, pageHasDeepFileInput, readFields, revealApplicationForm, uploadResume, waitForReadableApplyForm, waitForResumeUploadTarget, type DetectedField, type FormScope } from "../browser/form-filler.js";
import { candidate } from "../config/candidate.js";
import { enterGreenhouseSecurityCode, finalizeGreenhouseApplyForm, greenhouseJobAppFrame, inspectGreenhouseAfterSubmit, scrollGreenhouseFormIntoView } from "./greenhouse.js";
import { pollGreenhouseOtp } from "./greenhouse-otp-fetch.js";
import { directGreenhouseUrlsForCareersUrl, navigationRetryUrls } from "./job-navigation-url.js";
import {
  greenhouseNavAttemptsPerUrl,
  greenhouseNavMaxErrorSignals,
  shouldSkipGreenhouseTarget,
} from "./greenhouse-nav-bounds.js";
import { submitApplication } from "../browser/submit-application.js";
import { withHeadlessBrowser } from "../browser/session.js";
import { saveScreenshot } from "../browser/screenshot.js";
import { buildCvDocument, CvGenerationError, writeCvPdf } from "../cv/generate.js";
import { portfolioUrlForDoc } from "../cv/portfolio.js";
import { validateCv } from "../cv/validate.js";
import { evaluateCvRelevance, validateCvQuality, validatePdfArtifact, type CvRelevanceResult } from "../cv/relevance.js";
import { saveRedactedFailureArtifact } from "./failure-artifact.js";
import { citeSupportedEvidence, validateCvCoversEvidence, type RequirementEvidenceRow } from "./grounded-fit.js";
import { cvUsedLabelForLeadIdentity, resolveLeadIdentity } from "../cv/lead-identity.js";
import { normalizeSelectedSkills } from "../cv/validate.js";
import { log } from "../logging/logger.js";
import type { ApplicationResult, CvSource, Persona, SubmissionScope } from "../models/types.js";
import type { LedgerEntry } from "./ledger.js";
import { isExcludedApplyTarget } from "./exclude-company.js";
import { alreadySubmitted, priorTerminalEntry, rememberSubmission } from "./ledger.js";
import {
  detectGotFriendsConfirmation,
  prepareGotFriendsJobApplyPage,
  readGotFriendsFormEvidence,
  resolveGotFriendsScopeFromEvidence,
} from "./gotfriends.js";
import { enrichLedgerEntryForScope, shouldSkipApplyForScopeDedup } from "./submission-dedup.js";
import {
  agencyContextFromUrl,
  countsAsConfirmedEmployerApplication,
} from "./submission-scope.js";
import { chooseOpening, careersPositionId, listOpenings, openChosen, openingMatchesPositionId } from "./pick-opening.js";
import { greenhouseBoardSlug } from "./job-navigation-url.js";
import { fetchGreenhouseBoardOpenings, listingsNeedGreenhouseApiFallback } from "./openings.js";
import { chooseSalary, classifyPublishedSalary } from "./salary.js";
import { resolveJobLocationEligible, resolveJobLocationVerdict } from "../discovery/resolve-location-eligibility.js";
import { postingGoneReason, redirectedAwayReason } from "./posting-gone.js";
import { fitLocationRejection } from "./fit-location-guard.js";
import { fetchPostingTextForFit } from "./fetch-posting-text.js";
import { analyzeFullJobFit } from "./job-fit-llm.js";
import type { JobFitResult } from "./job-fit.js";
import {
  declineReasonFromFieldLabels,
  matchesOfficeCommuteSkip,
  OFFICE_COMMUTE_SKIP_REASON,
} from "./skip-job-screening.js";
import { detectConfirmation, detectEmailVerification, detectLoginWall, classifyCaptchaSignal } from "./verify-submission.js";
import { newAttemptId } from "./attempt-ledger.js";
import { extractHttpUrlFromCell, parseHttpUrl } from "./automatable-url.js";
import {
  classifyPostingContent,
  postingContentBlocksFit,
} from "./posting-content-quality.js";
import { hostDoesNotExist, isNameNotResolvedError } from "./dead-host.js";
import { looksLikeRateLimit, noteHostSuccess, noteRateLimit } from "./rate-limit.js";
import { isLinkedInHost, isLinkedInJobUrl, linkedinEasyApplyEnabled, linkedinFeatureDisabledResult, runLinkedInEasyApply } from "./linkedin-easy-apply.js";
import {
  captchaApplyContext,
  noteCaptchaSignalOnApply,
  noteCaptchaSolverProvider,
  resetCaptchaApplyContext,
} from "./captcha-apply-context.js";
import { noteCaptchaSiteApplyConfirmed } from "./captcha-solver-stats.js";
import { trySolveActiveCaptcha } from "../browser/captcha-solver.js";
import type { AttemptPipeline } from "../models/types.js";
import { applicationStateFromEvidence } from "./application-state.js";

export type ApplyInput = {
  attemptId?: string;
  startedAt?: string;
  pipeline?: AttemptPipeline;
  recoveredFrom?: {
    originalRole: string;
    originalUrl: string;
    replacementRole: string;
  };
  row?: number;
  submit: boolean;
  /** MCP preview / submit=false: no attempt ledger, quota, or sheet writes. */
  mcpDryRun?: boolean;
  ignoreLedger?: boolean;
  workspaceId?: string;
  runSource?: import("../models/types.js").ApplyRunSource;
  runId?: string;
  batchId?: string;
  triggeredAt?: string;
  job: {
    role: string;
    company: string;
    url: string;
    matchScore?: number;
    category?: string;
    estimatedSalary?: string;
    opportunityKind?: "employment" | "contract" | "freelance_project";
  };
  /** MCP submit safety: persist checkpoint before/after the final Submit click. */
  onSubmissionCheckpoint?: (stage: "pre_submit" | "post_submit_click") => Promise<void>;
  /** Shared owner for PostgreSQL canonical job submit guard (scheduler + MCP). */
  canonicalSubmitGuardOwnerToken?: string;
};

export async function applyToJob(context: BrowserContext, input: ApplyInput): Promise<ApplicationResult> {
  const started = input.startedAt ?? new Date().toISOString();
  const attemptId = input.attemptId ?? newAttemptId();
  const pipeline = input.pipeline ?? {
    urlValidated: false,
    opened: false,
    recovered: false,
    fitPassed: false,
    cvGenerated: false,
    cvQualityPassed: false,
    submitted: false,
    confirmed: false,
  };
  input = { ...input, attemptId, startedAt: started, pipeline };
  resetCaptchaApplyContext();
  const day = todayJerusalem();
  let jobSlug = slug(`${input.job.company}-${input.job.role}`);
  let shotDir = `${env.screenshotDir}/${day}/${jobSlug}`;
  const screenshots: string[] = [];
  const normalizedUrl = extractHttpUrlFromCell(input.job.url) ?? input.job.url;
  const parsedUrl = parseHttpUrl(normalizedUrl);
  if (!parsedUrl) {
    log("INVALID_JOB_URL", { url: input.job.url });
    return result(input, {
      status: "invalid_url",
      terminalOutcome: "invalid_url",
      submitted: false,
      confirmationDetected: false,
      blocker: "invalid_url",
      notes: lines([
        "result=invalid_url",
        "The job URL is not a valid HTTP(S) URL. Nothing was opened.",
      ]),
      screenshots,
    });
  }
  input.job.url = parsedUrl.toString();
  pipeline.urlValidated = true;
  if (isExcludedApplyTarget(input.job.company, input.job.url)) {
    log("COMPANY_EXCLUDED", { company: input.job.company, url: input.job.url });
    return result(input, {
      status: "not_relevant",
      submitted: false,
      confirmationDetected: false,
      notes: lines([
        "result=not_relevant",
        "reason=company_excluded",
        `company=${input.job.company}`,
        "Company or job URL is on the apply exclude list. Nothing was submitted.",
      ]),
      screenshots,
    });
  }
  if (input.submit && !input.ignoreLedger) {
    const scopeSkip = shouldSkipApplyForScopeDedup(input.job.url, input.workspaceId);
    if (scopeSkip.skip) {
      return result(input, {
        status: "already_submitted",
        submitted: false,
        confirmationDetected: false,
        blocker: scopeSkip.reason ?? "already_submitted",
        notes: lines([
          "result=already_submitted",
          `blocker=${scopeSkip.reason ?? "already_submitted"}`,
          scopeSkip.hit ? `dedup_key=${scopeSkip.hit.key}` : "",
          "A prior confirmed submission exists for this scope. Not submitted again.",
        ].filter(Boolean)),
        screenshots,
      });
    }
    const prior = priorTerminalEntry(input.job.url);
    if (prior?.confirmationDetected || alreadySubmitted(input.job.url)) {
      return result(input, {
        status: "already_submitted",
        submitted: false,
        confirmationDetected: false,
        blocker: "already_submitted",
        notes: lines(["result=review", "blocker=already_submitted", "Previous confirmation exists. Not submitted again."]),
        screenshots,
      });
    }
    if (prior?.blocker === "submitted_unconfirmed") {
      return result(input, {
        status: "already_submitted",
        submitted: false,
        confirmationDetected: false,
        blocker: "submitted_unconfirmed",
        canonicalJobUrl: prior.canonicalJobUrl,
        notes: lines([
          "result=already_submitted",
          "blocker=submitted_unconfirmed",
          "A prior submit was sent without confirmation. Resolve manually before auto-retry.",
        ]),
        screenshots,
      });
    }
    if (prior?.blocker) {
      return result(input, {
        status: "manual_required",
        submitted: false,
        confirmationDetected: false,
        blocker: prior.blocker,
        notes: lines([
          "result=manual_required",
          `blocker=${prior.blocker}`,
          "Auto-apply already hit this gate earlier. Finish in a browser if you still want the job.",
        ]),
        screenshots,
      });
    }
  }

  if (isLinkedInHost(input.job.url) && !linkedinEasyApplyEnabled()) {
    log("LINKEDIN_EASY_APPLY_DISABLED", { url: input.job.url });
    return { ...linkedinFeatureDisabledResult(input.job.url), attemptId, pipeline, screenshots };
  }

  const preflight = await preflightJobFit(input);
  if (preflight) {
    return { ...preflight, attemptId, pipeline, screenshots };
  }

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(env.navigationTimeoutMs);
  page.setDefaultTimeout(env.actionTimeoutMs);
  try {
    let listingNote: Awaited<ReturnType<typeof enterBestOpening>> = null;
    let earlyExit: EarlyExit | null = null;
    try {
      await openJob(page, input.job.url);
      // A sign-in wall or an unrelated website has no openings to pick from: decide that BEFORE list recovery,
      // otherwise its nav links are mistaken for a job list.
      earlyExit = earlyExitReason(input.job.url, page.url());
      if (!earlyExit) {
        listingNote = await enterBestOpening(page, input.job.role, input.job.company, input.job.url);
        if (listingNote?.recovered) {
          input.recoveredFrom = {
            originalRole: input.job.role,
            originalUrl: input.job.url,
            replacementRole: listingNote.title,
          };
          pipeline.recovered = true;
        }
        await ensurePositionDetailPage(page, input.job.role, input.job.url);
        await tryGreenhouseCareersFallback(page, input.job.url);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "navigation_failed";
      log("JOB_NAVIGATION_FAILED", { url: input.job.url, message });
      if (isNameNotResolvedError(message) && await hostDoesNotExist(input.job.url)) {
        log("JOB_CLOSED", { pageStatus: "DEAD_HOST", url: input.job.url });
        return result(input, {
          status: "closed",
          submitted: false,
          confirmationDetected: false,
          notes: lines(["result=closed", "reason=job_removed", "Job host no longer exists in DNS (careers site retired)."]),
          screenshots,
        });
      }
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "navigation_failed",
        notes: lines([
          "result=review",
          "blocker=navigation_failed",
          message.split("\n", 1)[0],
          "Could not open the job page in the browser.",
        ]),
        screenshots,
      });
    }
    log("JOB_OPENED", {
      url: page.url(),
      company: input.job.company,
      role: input.job.role,
      state: applicationStateFromEvidence({}),
    });
    pipeline.opened = true;
    if (isLinkedInHost(page.url()) || isLinkedInHost(input.job.url)) {
      if (!linkedinEasyApplyEnabled()) {
        log("LINKEDIN_EASY_APPLY_DISABLED", { url: page.url() });
        return result(input, linkedinFeatureDisabledResult(input.job.url));
      }
    }
    if (isLinkedInJobUrl(page.url()) || isLinkedInJobUrl(input.job.url)) {
      const linkedIn = await runLinkedInEasyApply(page, input, undefined);
      if (linkedIn) {
        if (linkedIn.confirmationDetected) {
          noteHostSuccess(page.url());
        }
        return linkedIn;
      }
    }
    const openedText = await page.locator("body").innerText().catch(() => "");
    if (looksLikeRateLimit(openedText)) {
      noteRateLimit(page.url(), "page_rate_limit_copy");
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "rate_limited",
        notes: lines([
          "result=review",
          "blocker=rate_limited",
          "The site asked us to slow down. Cooldown recorded; this host will be skipped until it expires.",
        ]),
        screenshots,
      });
    }
    screenshots.push(await saveScreenshot(page, shotDir, "job-page.png"));
    await prepareGotFriendsJobApplyPage(page);
    if (earlyExit?.kind === "login_wall") {
      log("JOB_LOGIN_WALL", { url: page.url(), company: input.job.company });
      return await loginWallResult(input, screenshots, page.url());
    }
    if (earlyExit?.kind === "gone") {
      log("JOB_POSTING_GONE", { reason: earlyExit.reason, original: input.job.url, landed: page.url() });
      return closedResult(input, screenshots, `Posting is gone (${earlyExit.reason}).`, page.url());
    }
    if (listingNote?.blocked) {
      if (listingNote.outcome === "location_ineligible") {
        return result(input, {
          status: "location_ineligible",
          submitted: false,
          confirmationDetected: false,
          canonicalJobUrl: listingNote.canonicalUrl,
          notes: lines(["result=not_relevant", "reason=location_ineligible", listingNote.line, "Nothing was submitted."]),
          screenshots,
        });
      }
      const skipped = listingNote.outcome === "not_relevant";
      return result(input, {
        status: skipped ? "not_relevant" : "review",
        submitted: false,
        confirmationDetected: false,
        terminalOutcome: skipped ? "no_suitable_replacement" : undefined,
        blocker: skipped ? "no_suitable_replacement" : "no_matching_opening",
        canonicalJobUrl: page.url(),
        notes: lines([
          skipped ? "result=not_relevant" : "result=review",
          skipped ? "reason=no_good_match" : "blocker=no_matching_opening",
          listingNote.line,
          skipped ? "Nothing was submitted." : "",
        ].filter(Boolean)),
        screenshots,
      });
    }
    let bodyText = await page.locator("body").innerText();
    let activeRole = listingNote?.title ?? input.job.role;
    let pageStatus = classifyJobPage({
      url: page.url(),
      title: await page.title(),
      text: bodyText,
      role: activeRole,
    });
    // Order matters: decide what KIND of page this is before judging its location. A removed posting, a sign-in
    // wall or a careers home says nothing about the job's city, so none of them may become "location_ineligible".
    if (pageStatus === "CLOSED" || pageStatus === "NOT_FOUND") {
      log("JOB_CLOSED", { pageStatus });
      return closedResult(input, screenshots, "Live check: job no longer available.", page.url());
    }
    if (/error=true/i.test(page.url()) && !await pageHasResumeField(page)) {
      log("JOB_GREENHOUSE_BOARD_ERROR", { url: page.url() });
      return closedResult(input, screenshots, "Greenhouse returned error=true (posting missing or board link).", page.url());
    }
    if (pageStatus === "LOGIN_WALL") {
      log("JOB_LOGIN_WALL", { url: page.url(), company: input.job.company });
      return await loginWallResult(input, screenshots, page.url());
    }
    if (!listingNote && !await pageHasResumeField(page)) {
      const goneReason = await postingGoneReason(input.job.url, page.url());
      if (goneReason) {
        log("JOB_POSTING_GONE", { reason: goneReason, original: input.job.url, landed: page.url() });
        return closedResult(input, screenshots, `Posting is gone (${goneReason}).`, page.url());
      }
    }
    if (pageStatus === "CAREERS_PAGE") {
      await tryGreenhouseCareersFallback(page, input.job.url);
      bodyText = await page.locator("body").innerText();
      pageStatus = classifyJobPage({
        url: page.url(),
        title: await page.title(),
        text: bodyText,
        role: activeRole,
      });
      if (pageStatus === "CAREERS_PAGE" && !(await pageHasResumeField(page)) && !(await pageHasApplyEmailField(page))) {
        return result(input, {
          status: "review",
          terminalOutcome: "no_suitable_replacement",
          submitted: false,
          confirmationDetected: false,
          blocker: "careers_page",
          notes: lines([
            "result=review",
            "blocker=careers_page",
            `landed_on=${page.url().split("?", 1)[0]}`,
            listingNote?.line ?? "Live page was a careers list, not one job.",
          ]),
          screenshots,
        });
      }
    }
    const locationVerdict = await resolveJobLocationVerdict({ title: activeRole, snippet: bodyText, url: page.url() });
    if (!locationVerdict.eligible) {
      log("JOB_LOCATION_INELIGIBLE", {
        company: input.job.company,
        role: activeRole,
        url: page.url(),
        source: locationVerdict.source,
        reason: locationVerdict.reason,
        attemptId: input.attemptId,
      });
      return locationIneligibleResult(input, screenshots, page.url(), locationVerdict.reason);
    }
    if (pageStatus === "UNKNOWN") {
      log("JOB_PAGE_UNCONFIRMED", { url: page.url(), company: input.job.company });
    }

    const skipSalaryFloor =
      input.job.opportunityKind === "freelance_project" || input.job.opportunityKind === "contract";
    const salaryVerdict = skipSalaryFloor
      ? ({ kind: "ok" as const, detail: "" })
      : classifyPublishedSalary(bodyText);
    if (salaryVerdict.kind === "exclude") {
      log("JOB_REJECTED_LOW_SALARY", { detail: salaryVerdict.detail, tier: "exclude_below_18000" });
      return result(input, {
        status: "not_relevant",
        submitted: false,
        confirmationDetected: false,
        notes: lines([
          "result=not_relevant",
          "reason=salary_below_exclude_threshold",
          salaryVerdict.detail,
          "Excluded: published max below ILS 18,000/month.",
        ]),
        screenshots,
      });
    }
    if (salaryVerdict.kind === "manual_review") {
      log("JOB_SALARY_MANUAL_REVIEW", { detail: salaryVerdict.detail, tier: "18000_to_19999" });
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "salary_manual_review_band",
        notes: lines([
          "result=review",
          "reason=salary_manual_review_band",
          salaryVerdict.detail,
          "Published salary is ILS 18,000–19,999/month — kept for manual review; no auto-quote of processing minimum.",
        ]),
        screenshots,
      });
    }

    const contentVerdict = classifyPostingContent(bodyText, page.url());
    if (postingContentBlocksFit(contentVerdict)) {
      return postingContentBlockedResult(input, contentVerdict, page.url(), screenshots);
    }

    let fit;
    try {
      fit = await analyzeFullJobFit({
        role: activeRole,
        company: input.job.company,
        jobText: bodyText,
        trackerCategory: input.job.category,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "full_job_fit_failed";
      log("JOB_FIT_FAILED", { message, role: activeRole, url: page.url() });
      return result(input, {
        status: "review",
        terminalOutcome: "request_failed",
        submitted: false,
        confirmationDetected: false,
        blocker: "full_job_fit_failed",
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=review",
          "blocker=full_job_fit_failed",
          message,
          "The complete job description could not be validated, so no application was sent.",
        ]),
        screenshots,
      });
    }
    log("JOB_FIT_EVALUATED", {
      role: activeRole,
      score: fit.fitScore,
      decision: fit.decision,
      missingMustHaves: fit.missingMustHaves,
      risks: fit.risks,
    });
    // The model read the whole posting, so its stated location is better evidence than a footer that lists every office.
    const fitLocation = fitLocationRejection(fit.requirements, activeRole);
    if (fitLocation) {
      log("JOB_LOCATION_INELIGIBLE", { role: activeRole, url: page.url(), source: "job_fit", reason: fitLocation, stated: fit.requirements.location });
      return locationIneligibleResult(input, screenshots, page.url(), `job_fit:${fitLocation}:${fit.requirements.location}`);
    }
    if (fit.decision !== "apply" || !fit.persona) {
      const replacementRejected = Boolean(input.recoveredFrom);
      return result(input, {
        status: "not_relevant",
        terminalOutcome: replacementRejected ? "no_suitable_replacement" : "not_relevant",
        submitted: false,
        confirmationDetected: false,
        blocker: replacementRejected ? "no_suitable_replacement" : "full_job_fit_failed",
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=not_relevant",
          "reason=full_job_fit_failed",
          `fit_score=${fit.fitScore}`,
          `missing_must_haves=${fit.missingMustHaves.join(", ") || "none"}`,
          `risks=${fit.risks.join(", ") || "none"}`,
          fit.reason,
          "No application was sent because the complete job description did not pass the candidate-fit gate.",
        ]),
        screenshots,
      });
    }
    pipeline.fitPassed = true;
    const persona = fit.persona;
    const salaryMonthly = chooseSalary(activeRole, persona);

    if (matchesOfficeCommuteSkip(bodyText)) {
      log("JOB_SKIPPED_SCREENING", { company: input.job.company, reason: "office_commute_in_posting" });
      return result(input, {
        status: "not_relevant",
        submitted: false,
        confirmationDetected: false,
        persona,
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=not_relevant",
          "reason=office_commute_policy",
          OFFICE_COMMUTE_SKIP_REASON,
          "Nothing was submitted.",
        ]),
        screenshots,
      });
    }

    await dismissOverlays(page);
    await revealApplyForm(page);
    await dismissOverlays(page);
    await page.evaluate(() => {
      document.querySelector("#application-form, .application--form, iframe[src*='greenhouse']")?.scrollIntoView({ block: "center" });
    }).catch(() => undefined);
    const preCaptchaSignal = await classifyCaptchaSignal(page);
    log("CAPTCHA_SIGNAL", {
      company: input.job.company,
      ats: atsLabel(page.url()),
      stage: "pre_submit",
      signal: preCaptchaSignal,
    });
    noteCaptchaSignalOnApply(preCaptchaSignal);
    if (await detectLoginWall(page)) {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      rememberManualApply(input, {
        blocker: "login_required",
        canonicalJobUrl: page.url(),
      });
      return result(input, {
        status: "manual_required",
        submitted: false,
        confirmationDetected: false,
        blocker: "login_required",
        persona,
        notes: lines([
          "result=manual_required",
          "blocker=login_required",
          "Apply opened an account / email login gate (often iCIMS). Account creation is not handled in this version.",
        ]),
        screenshots,
      });
    }

    await revealApplicationForm(page);
    if (/smartrecruiters\.com/i.test(page.url())) {
      await waitForReadableApplyForm(page, 30_000);
    }
    const scope = await applyFormScope(page);
    const fields = await readFields(scope);
    log("APPLICATION_STATE", { state: applicationStateFromEvidence({ formDetected: fields.length > 0 }), fields: fields.length });
    log("FORM_DETECTED", { fields: fields.map((field) => field.label) });
    const fieldLabels = fields.map((field) => `${field.label} ${field.groupLabel ?? ""}`.trim());
    const screeningSkip = declineReasonFromFieldLabels(fieldLabels);
    if (screeningSkip) {
      log("JOB_SKIPPED_SCREENING", { company: input.job.company, reason: "office_commute_on_form" });
      return result(input, {
        status: "not_relevant",
        submitted: false,
        confirmationDetected: false,
        persona,
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=not_relevant",
          "reason=office_commute_policy",
          screeningSkip,
          "Nothing was submitted.",
        ]),
        screenshots,
      });
    }
    if (fields.length === 0 || looksLikeSiteChromeFields(fields)) {
      log("FORM_NOT_DETECTED", {
        url: page.url(),
        pageStatus,
        fieldCount: fields.length,
        fields: fields.map((field) => field.label).filter(Boolean).slice(0, 20),
      });
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "form_not_detected",
        persona,
        notes: lines([
          "result=review",
          "blocker=form_not_detected",
          `page_status=${pageStatus}`,
          `field_count=${fields.length}`,
          `page_url=${page.url()}`,
        ]),
        screenshots,
      });
    }

    jobSlug = resolveArtifactSlug(input.job.company, activeRole, page.url());
    shotDir = `${env.screenshotDir}/${day}/${jobSlug}`;

    let cv;
    try {
      cv = await prepareCv(
        { ...input, job: { ...input.job, role: activeRole } },
        persona,
        bodyText,
        fit.requirements,
        fit.requirementEvidence,
        day,
        jobSlug,
        input.attemptId,
      );
    } catch (error) {
      const reason = error instanceof CvGenerationError ? error.message : "cv_generation_failed";
      log("CV_REJECTED", { reason, fatal: true });
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "cv_generation_failed",
        persona,
        notes: lines([
          "result=review",
          "blocker=cv_generation_failed",
          reason,
          "No CV was uploaded. Fix the LLM draft or fact pool, then retry.",
        ]),
        screenshots,
      });
    }
    log("CV_SELECTED", {
      persona,
      leadIdentity: resolveLeadIdentity({ persona, trackerCategory: input.job.category }),
      wording: cv.wording,
      source: cv.cvSource,
      path: cv.cvPath,
    });

    const filled = await fillFields({
      scope,
      fields,
      persona,
      ctx: {
        persona,
        trackerCategory: input.job.category,
        salaryMonthly,
        portfolioUrl: cv.portfolioUrl,
        euRole: /europe|eu\b|poland/i.test(bodyText),
        company: input.job.company,
        role: activeRole,
        jobUrl: page.url(),
        jobText: jobBrief(bodyText),
      },
      jobText: jobBrief(bodyText),
    });
    if (filled.skipJob) {
      log("JOB_SKIPPED_SCREENING", { company: input.job.company, reason: "office_commute_while_filling" });
      return result(input, {
        status: "not_relevant",
        submitted: false,
        confirmationDetected: false,
        persona,
        ...cv.publicFields,
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=not_relevant",
          "reason=office_commute_policy",
          filled.skipJob.reason,
          "Nothing was submitted.",
        ]),
        screenshots,
      });
    }
    const uploaded = await uploadResume(page, cv.cvPath);
    const greenhouseFrame = greenhouseJobAppFrame(page);
    if (greenhouseFrame) {
      await dismissOverlays(page);
      await finalizeGreenhouseApplyForm(greenhouseFrame, filled.answers, { portfolioUrl: cv.portfolioUrl }).catch((error) => {
        log("GREENHOUSE_FINALIZE_FAILED", { message: error instanceof Error ? error.message : "finalize_failed" });
      });
    }
    if (!uploaded) {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "cv_upload_failed",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        notes: lines(["result=review", "blocker=cv_upload_failed", listingNote?.line ?? "", "The PDF was not attached, so the form was not submitted."].filter(Boolean)),
        canonicalJobUrl: page.url(),
        screenshots,
      });
    }
    screenshots.push(await saveScreenshot(page, shotDir, "before-submit.png"));
    if (filled.blockers.length > 0) {
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "missing_fact",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        notes: lines(["result=review", "blocker=missing_fact", ...filled.blockers]),
        screenshots,
      });
    }
    if (!input.submit) {
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "dry_run",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        notes: lines(["result=review", "blocker=dry_run", `cv=${cv.publicFields.cvUsed}`, "Form filled and CV attached. Submit was not clicked."]),
        screenshots,
      });
    }

    await dismissOverlays(page);
    await humanPause(page, 800, 1600);
    const ghBeforeSubmit = greenhouseJobAppFrame(page);
    if (ghBeforeSubmit) {
      await finalizeGreenhouseApplyForm(ghBeforeSubmit, filled.answers, { portfolioUrl: cv.portfolioUrl }).catch((error) => {
        log("GREENHOUSE_FINALIZE_FAILED", { message: error instanceof Error ? error.message : "finalize_presubmit_failed", stage: "pre_submit" });
      });
    }
    const gotfriendsHost = /gotfriends\.co\.il/i.test(page.url());
    const applyPost = gotfriendsHost ? null : watchApplyPost(page);
    const gfEvidenceBeforeSubmit = gotfriendsHost ? await readGotFriendsFormEvidence(page) : null;
    if (input.onSubmissionCheckpoint) {
      await input.onSubmissionCheckpoint("pre_submit");
    }
    let activeScope = scope;
    let submitAttempt = await submitApplication(page, activeScope);
    if (submitAttempt.clicked && input.onSubmissionCheckpoint) {
      await input.onSubmissionCheckpoint("post_submit_click");
    }
    log("SUBMIT_CLICKED", { url: page.url(), clicked: submitAttempt.clicked, invalid: submitAttempt.invalid });
    log("APPLICATION_STATE", {
      state: applicationStateFromEvidence({ submitted: submitAttempt.clicked && submitAttempt.advanced !== true, nextStep: submitAttempt.advanced === true }),
    });
    for (let step = 1; submitAttempt.clicked && submitAttempt.advanced === true && step <= 4; step += 1) {
      await page.waitForTimeout(800);
      activeScope = await applyFormScope(page);
      const stepFields = await readFields(activeScope);
      const stepFilled = await fillFields({
        scope: activeScope,
        fields: stepFields,
        persona,
        ctx: {
          persona,
          salaryMonthly,
          portfolioUrl: cv.portfolioUrl,
          euRole: /europe|eu\b|poland/i.test(bodyText),
          company: input.job.company,
          role: activeRole,
          jobUrl: page.url(),
          jobText: jobBrief(bodyText),
        },
        jobText: jobBrief(bodyText),
      });
      if (stepFilled.skipJob || stepFilled.blockers.length > 0) {
        return result(input, {
          status: stepFilled.skipJob ? "not_relevant" : "review",
          submitted: false,
          confirmationDetected: false,
          blocker: stepFilled.skipJob ? undefined : "missing_fact",
          persona,
          ...cv.publicFields,
          answers: [...filled.answers, ...stepFilled.answers],
          canonicalJobUrl: page.url(),
          notes: lines([
            stepFilled.skipJob ? "result=not_relevant" : "result=review",
            stepFilled.skipJob ? "reason=office_commute_policy" : "blocker=missing_fact",
            ...(stepFilled.skipJob ? [stepFilled.skipJob.reason] : stepFilled.blockers),
          ]),
          screenshots,
        });
      }
      await uploadResume(page, cv.cvPath);
      submitAttempt = await submitApplication(page, activeScope);
      log("APPLICATION_STEP_ADVANCED", { step, clicked: submitAttempt.clicked, advanced: submitAttempt.advanced === true });
    }
    if (submitAttempt.advanced === true) {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "form_validation",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        canonicalJobUrl: page.url(),
        notes: lines(["result=review", "blocker=form_validation", "multi_step_limit=4", "The application had more steps than the safe generic traversal limit."]),
        screenshots,
      });
    }
    if (!submitAttempt.clicked) {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "form_validation",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=review",
          "blocker=form_validation",
          `invalid=${submitAttempt.invalid.join(",") || "unknown"}`,
          "The form was still invalid, so Submit was not sent.",
        ]),
        screenshots,
      });
    }
    pipeline.submitted = true;
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(8000);
    for (const frame of page.frames()) {
      if (/greenhouse\.io/i.test(frame.url())) {
        await frame.waitForURL(/application_id=|greenhouse\.io/, { timeout: 12_000 }).catch(() => undefined);
        break;
      }
    }
    let greenhouseAfter = greenhouseJobAppFrame(page) ? await inspectGreenhouseAfterSubmit(page) : null;
    let preConfirmed: { ok: boolean; phrase: string } | null = null;
    if (greenhouseAfter) {
      log("GREENHOUSE_AFTER_SUBMIT", {
        kind: greenhouseAfter.kind,
        recaptcha: greenhouseAfter.recaptcha,
        cheqInvalid: greenhouseAfter.cheqInvalid,
        excerpt: greenhouseAfter.excerpt.slice(0, 240),
      });
      await scrollGreenhouseFormIntoView(page);
    }
    if (greenhouseAfter?.kind === "form_still_open" || greenhouseAfter?.kind === "validation") {
      preConfirmed = await detectConfirmation(page).then(async (seen) => seen.ok ? seen : (await applyPost) ?? seen);
      if (!preConfirmed?.ok) {
        const validation = greenhouseAfter.kind === "validation";
        const invisibleCaptcha = greenhouseAfter.recaptcha === "invisible" || greenhouseAfter.recaptcha === "challenge";
        const captchaBlocker = greenhouseAfter.recaptcha === "challenge"
          || (greenhouseAfter.kind === "form_still_open" && invisibleCaptcha);
        if (captchaBlocker) {
          const captchaSignal = greenhouseAfter.recaptcha === "challenge" ? "active_challenge" : "passive_widget";
          noteCaptchaSignalOnApply(captchaSignal);
          log("CAPTCHA_REQUIRED", {
            company: input.job.company,
            stage: "post_submit_greenhouse",
            signal: captchaSignal,
            recaptcha: greenhouseAfter.recaptcha,
          });
          const solved = await trySolveActiveCaptcha(page, page.url());
          if (solved.ok) {
            if (solved.provider) {
              noteCaptchaSolverProvider(solved.provider);
            }
            log("CAPTCHA_SOLVED_CONTINUE", {
              url: page.url(),
              provider: solved.provider ?? solved.reason,
              flow: "greenhouse_resubmit",
            });
            await retryGreenhouseSubmitAfterCaptcha(page);
            greenhouseAfter = await inspectGreenhouseAfterSubmit(page);
            log("GREENHOUSE_AFTER_SUBMIT", {
              kind: greenhouseAfter.kind,
              recaptcha: greenhouseAfter.recaptcha,
              cheqInvalid: greenhouseAfter.cheqInvalid,
              excerpt: greenhouseAfter.excerpt.slice(0, 240),
              flow: "after_captcha_solve",
            });
            preConfirmed = await detectConfirmation(page).then(async (seen) => seen.ok ? seen : (await applyPost) ?? seen);
          } else {
            screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
            noteRateLimit(page.url(), `captcha_unsolved:${solved.reason}`);
            rememberManualApply(input, {
              blocker: "captcha",
              cvPath: cv.cvPath,
              captchaSignal: captchaSignal === "active_challenge" ? "active_challenge" : "passive_widget",
              stage: "post_submit",
              answers: filled.answers,
              canonicalJobUrl: page.url(),
            });
            return result(input, {
              status: "manual_required",
              submitted: false,
              confirmationDetected: false,
              blocker: "captcha",
              persona,
              ...cv.publicFields,
              answers: filled.answers,
              canonicalJobUrl: page.url(),
              notes: lines([
                "result=manual_required",
                "blocker=captcha",
                `captchaSignal=${captchaSignal}`,
                "Greenhouse CAPTCHA blocked submit. Buster and 2captcha did not clear it.",
                `solver=${solved.reason}`,
                `greenhouse_kind=${greenhouseAfter.kind}`,
                `recaptcha=${greenhouseAfter.recaptcha}`,
              ]),
              screenshots,
            });
          }
        }
        if (!preConfirmed?.ok && (greenhouseAfter.kind === "form_still_open" || greenhouseAfter.kind === "validation")) {
          screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
          const why = greenhouseAfter.recaptcha === "challenge"
            ? "Greenhouse showed a visible reCAPTCHA challenge, so the application was not accepted."
            : validation
              ? "Greenhouse kept the form open and showed a validation error. The application was not accepted."
              : invisibleCaptcha
                ? "Submit was clicked but Greenhouse did not show confirmation (often invisible reCAPTCHA on Similarweb embeds)."
                : "The Submit application button is still on the form. The click did not leave the application form.";
          const blocker = captchaBlocker
            ? "captcha"
            : validation
              ? "form_validation"
              : "submit_not_accepted";
          if (blocker === "captcha") {
            rememberManualApply(input, {
              blocker: "captcha",
              cvPath: cv.cvPath,
              captchaSignal: greenhouseAfter.recaptcha === "challenge" ? "active_challenge" : "passive_widget",
              stage: "post_submit",
              answers: filled.answers,
              canonicalJobUrl: page.url(),
            });
          }
          return result(input, {
            status: blocker === "captcha" ? "manual_required" : "review",
            submitted: false,
            confirmationDetected: false,
            blocker,
            persona,
            ...cv.publicFields,
            answers: filled.answers,
            canonicalJobUrl: page.url(),
            notes: lines([
              `result=${blocker === "captcha" ? "manual_required" : "review"}`,
              `blocker=${blocker}`,
              `greenhouse_kind=${greenhouseAfter.kind}`,
              `recaptcha=${greenhouseAfter.recaptcha}`,
              `cheq_invalid=${greenhouseAfter.cheqInvalid}`,
              `greenhouse_excerpt=${greenhouseAfter.excerpt}`,
              why,
            ]),
            screenshots,
          });
        }
      }
    }
    const postCaptchaSignal = await classifyCaptchaSignal(page);
    log("CAPTCHA_SIGNAL", {
      company: input.job.company,
      ats: atsLabel(page.url()),
      stage: "post_submit",
      signal: postCaptchaSignal,
    });
    noteCaptchaSignalOnApply(postCaptchaSignal);
    if (postCaptchaSignal === "active_challenge") {
      log("CAPTCHA_REQUIRED", { company: input.job.company, stage: "post_submit", signal: postCaptchaSignal });
      const solved = await trySolveActiveCaptcha(page, page.url());
      if (solved.ok) {
        if (solved.provider) {
          noteCaptchaSolverProvider(solved.provider);
        }
        log("CAPTCHA_SOLVED_CONTINUE", { url: page.url(), provider: solved.provider ?? solved.reason });
      } else {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      noteRateLimit(page.url(), `captcha_unsolved:${solved.reason}`);
      rememberManualApply(input, {
        blocker: "captcha",
        cvPath: cv.cvPath,
        captchaSignal: "active_challenge",
        stage: "post_submit",
        answers: filled.answers,
        canonicalJobUrl: page.url(),
      });
      return result(input, {
        status: "manual_required",
        submitted: false,
        confirmationDetected: false,
        blocker: "captcha",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        notes: lines([
          "result=manual_required",
          "blocker=captcha",
          "captchaSignal=active_challenge",
          "A visible CAPTCHA challenge appeared after submit. Solver did not clear it, so cooldown started.",
          `solver=${solved.reason}`,
        ]),
        screenshots,
      });
      }
    }
    const otpResolved = await resolveGreenhouseEmailVerification(page, scope, input, {
      persona,
      cvPublicFields: cv.publicFields,
      filledAnswers: filled.answers,
      shotDir,
      screenshots,
    });
    if (otpResolved) {
      return otpResolved;
    }
    let confirmed = preConfirmed?.ok
      ? preConfirmed
      : gotfriendsHost
        ? await detectGotFriendsConfirmation(page)
        : await detectConfirmation(page).then(async (seen) => seen.ok ? seen : (applyPost ? await applyPost : null) ?? seen);
    const agencyCtx = agencyContextFromUrl(input.job.url);
    const resolvedScope: SubmissionScope = gotfriendsHost
      ? resolveGotFriendsScopeFromEvidence(gfEvidenceBeforeSubmit, input.job.url)
      : agencyCtx.agencyId
        ? agencyCtx.intendedScope
        : "direct_employer_application";
    const confirmedStatus = statusForSubmissionScope(resolvedScope);
    screenshots.push(await saveScreenshot(page, shotDir, confirmed.ok ? "confirmation.png" : "blocker.png"));
    if (!confirmed.ok) {
      try {
        rememberSubmission(enrichLedgerEntryForScope({
          url: input.job.url,
          company: input.job.company,
          role: activeRole,
          confirmationDetected: false,
          at: new Date().toISOString(),
          cvPath: cv.cvPath,
          canonicalJobUrl: page.url(),
          blocker: "submitted_unconfirmed",
          stage: "post_submit",
        }, {
          url: input.job.url,
          workspaceId: input.workspaceId,
          scope: resolvedScope,
          agencyId: agencyCtx.agencyId,
          postingId: agencyCtx.postingId,
        }));
      } catch (error) {
        log("SUBMITTED_UNCONFIRMED_LEDGER_WRITE_FAILED", {
          message: error instanceof Error ? error.message : "ledger_write_failed",
        });
      }
      saveRedactedFailureArtifact(input.attemptId ?? "unknown", {
        company: input.job.company,
        role: activeRole,
        blocker: "confirmation_not_detected",
        canonicalJobUrl: page.url(),
        cvPath: cv.cvPath,
      });
      return result(input, {
        status: "manual_required",
        submitted: true,
        confirmationDetected: false,
        terminalOutcome: "confirmation_not_detected",
        blocker: "submitted_unconfirmed",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=manual_required",
          "blocker=submitted_unconfirmed",
          "Submit was sent but no confirmation was detected. Do not retry automatically.",
        ]),
        screenshots,
      });
    }
    log("SUBMISSION_CONFIRMED", { company: input.job.company, role: input.job.role });
    const captchaCtx = captchaApplyContext();
    if (captchaCtx?.hadCaptcha) {
      noteCaptchaSiteApplyConfirmed({
        solverProvider: captchaCtx.solverProvider,
        passiveOnly: !captchaCtx.solverProvider && captchaCtx.lastSignal === "passive_widget",
      });
    }
    pipeline.confirmed = true;
    const appliedAt = new Date().toISOString();
    try {
      rememberSubmission(enrichLedgerEntryForScope({
        url: input.job.url,
        company: input.job.company,
        role: activeRole,
        confirmationDetected: true,
        at: appliedAt,
        cvPath: cv.cvPath,
        canonicalJobUrl: page.url(),
      }, {
        url: input.job.url,
        workspaceId: input.workspaceId,
        scope: resolvedScope,
        agencyId: agencyCtx.agencyId,
        postingId: agencyCtx.postingId,
      }));
    } catch (error) {
      log("CONFIRMED_LEDGER_WRITE_FAILED", { message: error instanceof Error ? error.message : "ledger_write_failed" });
    }
    try {
      writeAudit(day, jobSlug, { started, input, persona, cv, answers: filled.answers, appliedAt });
    } catch (error) {
      log("CONFIRMED_AUDIT_WRITE_FAILED", { message: error instanceof Error ? error.message : "audit_write_failed" });
    }
    return result(input, {
      status: confirmedStatus,
      submitted: true,
      confirmationDetected: true,
      submissionScope: resolvedScope,
      agencyId: agencyCtx.agencyId ?? undefined,
      postingId: agencyCtx.postingId ?? undefined,
      appliedAt,
      persona,
      ...cv.publicFields,
      answers: filled.answers,
      canonicalJobUrl: page.url(),
      terminalOutcome: countsAsConfirmedEmployerApplication(resolvedScope)
        ? "applied"
        : resolvedScope === "agency_registration"
          ? "agency_registered"
          : "agency_job_referred",
      notes: lines([
        "AUTO_APPLY",
        `result=${confirmedStatus}`,
        `submission_scope=${resolvedScope}`,
        `cv=${cv.publicFields.cvUsed}`,
        `cv_source=${cv.cvSource}`,
        `ats=${atsLabel(input.job.url)}`,
        `salary_answer=${salaryMonthly}`,
        "confirmation=true",
        `confirmation_text=${confirmed.phrase}`,
        agencyCtx.postingId ? `agency_posting_id=${agencyCtx.postingId}` : "",
        listingNote?.line ?? "",
      ].filter(Boolean)),
      screenshots,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function prepareCv(
  input: ApplyInput,
  persona: Persona,
  jobText: string,
  requirements: import("./job-fit.js").JobRequirements,
  requirementEvidence: RequirementEvidenceRow[],
  day: string,
  jobSlug: string,
  attemptId?: string,
): Promise<{
  cvPath: string;
  cvSource: CvSource;
  wording: "llm";
  publicFields: Pick<ApplicationResult, "cvUsed" | "cvSource" | "cvWording" | "cvPath" | "cvRelevanceScore" | "factIds" | "ats">;
  portfolioUrl: string;
  relevance: CvRelevanceResult;
}> {
  const outputPath = `${env.generatedCvDir}/${day}/${jobSlug}-redacted-candidate.pdf`;
  const leadIdentity = resolveLeadIdentity({ persona, trackerCategory: input.job.category });
  let feedback = "";
  let lastFailure = "CV did not pass quality gates.";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const built = await buildCvDocument({
      persona,
      role: input.job.role,
      company: input.job.company,
      jobText,
      trackerCategory: input.job.category,
      feedback,
    });
    citeSupportedEvidence(built.doc, persona, requirementEvidence);
    normalizeSelectedSkills(built.doc, persona);
    const validation = validateCv(built.doc, persona, leadIdentity);
    if (!validation.ok) {
      lastFailure = validation.errors.join("; ");
      feedback = `Truth gate failed: ${lastFailure}. Fix only those issues.`;
      continue;
    }
    if (input.pipeline) {
      input.pipeline.cvGenerated = true;
    }
    const structural = validateCvQuality(built.doc, persona, leadIdentity);
    const evidenceCoverage = validateCvCoversEvidence(built.doc, persona, requirementEvidence);
    const relevance = evaluateCvRelevance(built.doc, requirements, persona);
    log("CV_QUALITY_EVALUATED", {
      relevanceScore: relevance.relevanceScore,
      evidenceCoverageOk: evidenceCoverage.ok,
      missingEvidenceRequirements: evidenceCoverage.missingRequirements,
      structural: structural.issues,
      attempt,
    });
    if (!structural.ok || !evidenceCoverage.ok) {
      lastFailure = [
        ...structural.issues,
        ...evidenceCoverage.missingRequirements.map((item) => `missing_evidence:${item}`),
      ].join("; ");
      feedback = [
        "Candidate fit is valid, but the CV must cite verified facts for each supported requirement.",
        `Missing evidence for: ${evidenceCoverage.missingRequirements.join(", ") || "none"}.`,
        `Structural issues: ${structural.issues.join(", ") || "none"}.`,
        "Reprioritize only verified facts and approved skills; do not fabricate missing experience.",
      ].join(" ");
      continue;
    }
    if (input.pipeline) {
      input.pipeline.cvQualityPassed = true;
    }
    await withHeadlessBrowser((browser) => writeCvPdf(browser, built.doc, persona, outputPath));
    const pdfQuality = validatePdfArtifact(outputPath);
    if (!pdfQuality.ok) {
      lastFailure = pdfQuality.issues.join("; ");
      feedback = `Rendered PDF quality failed: ${lastFailure}. Keep the CV concise and readable.`;
      continue;
    }
    const cvUsed = cvUsedLabelForLeadIdentity(leadIdentity);
    return {
      cvPath: outputPath,
      cvSource: "generated",
      wording: "llm",
      relevance,
      portfolioUrl: portfolioUrlForDoc(built.doc, persona),
      publicFields: {
        cvUsed,
        cvSource: "generated",
        cvWording: "llm",
        cvPath: outputPath,
        cvRelevanceScore: relevance.relevanceScore,
        factIds: validation.factIds,
        ats: atsLabel(input.job.url),
      },
    };
  }
  saveRedactedFailureArtifact(attemptId ?? "unknown", {
    company: input.job.company,
    role: input.job.role,
    blocker: "cv_generation_failed",
    lastFailure,
  });
  throw new CvGenerationError(`CV failed grounded evidence or rendered-quality gates: ${lastFailure}`);
}

function resolveArtifactSlug(company: string, role: string, pageUrl: string): string {
  const positionId = careersPositionId(pageUrl);
  const stem = positionId ? `${company}-${role}-${positionId}` : `${company}-${role}`;
  return slug(stem);
}

async function humanPause(page: Page, minMs: number, maxMs: number): Promise<void> {
  const wait = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  await page.waitForTimeout(wait);
}

async function openJob(page: Page, url: string): Promise<void> {
  let lastError: unknown;
  const targets = navigationRetryUrls(url);
  const maxPerUrl = greenhouseNavAttemptsPerUrl();
  const maxErrorSignals = greenhouseNavMaxErrorSignals();
  let greenhouseErrorSignals = 0;
  for (const target of targets) {
    if (await shouldSkipGreenhouseTarget(target)) {
      log("NAVIGATION_GREENHOUSE_SKIPPED_REMOVED", { target });
      continue;
    }
    for (let attempt = 1; attempt <= maxPerUrl; attempt += 1) {
      for (const waitUntil of ["domcontentloaded", "commit"] as const) {
        try {
          await page.goto(target, { waitUntil });
          await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 80, undefined, { timeout: 20_000 }).catch(() => undefined);
          if (/\/embed\/job_board\b/i.test(page.url()) && !/error=true/i.test(page.url())) {
            await dismissOverlays(page);
            return;
          }
          if (/error=true/i.test(page.url())) {
            greenhouseErrorSignals += 1;
            log("NAVIGATION_GREENHOUSE_ERROR", {
              target,
              landed: page.url(),
              signal: greenhouseErrorSignals,
              maxErrorSignals,
            });
            if (greenhouseErrorSignals >= maxErrorSignals) {
              throw new Error("navigation_failed_greenhouse_error_cap");
            }
            continue;
          }
          if (/greenhouse\.io/i.test(target) && !/greenhouse\.io/i.test(page.url())) {
            if (!/^https?:\/\//i.test(page.url())) {
              log("NAVIGATION_LEFT_GREENHOUSE", { target, landed: page.url() });
              continue;
            }
            // Greenhouse sends removed postings to the company careers page. That is a job LIST, not a dead end:
            // keep it as the landing page so enterBestOpening() can pick a matching opening.
            log("NAVIGATION_GREENHOUSE_REDIRECTED_TO_CAREERS", { target, landed: page.url() });
            await dismissOverlays(page);
            return;
          }
          await dismissOverlays(page);
          return;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : "";
          log("NAVIGATION_RETRY", { attempt, url: target, waitUntil, message: message.split("\n", 1)[0] });
          if (!/ERR_TOO_MANY_REDIRECTS/i.test(message)) {
            break;
          }
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("navigation_failed");
}

function jobBrief(text: string): string {
  const start = text.search(/responsibilit|requirements|תיאור המשרה|about the role/i);
  const slice = start >= 0 ? text.slice(Math.max(0, start - 200)) : text;
  return slice.slice(0, 6000);
}

function atsLabel(url: string): string {
  if (/comeet\.com/i.test(url)) {
    return "comeet";
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "career-site";
  }
}

async function dismissOverlays(page: Page): Promise<void> {
  const oneTrust = page.locator("#onetrust-accept-btn-handler").first();
  if (await oneTrust.count()) {
    await oneTrust.click({ timeout: 4000, force: true }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
  // PepsiCo / Phenom tracking banner uses a short "Accept" label, not "Accept all cookies".
  const pixelAccept = page.locator("#pixel-consent-accept-button").first();
  if (await pixelAccept.count()) {
    await pixelAccept.click({ timeout: 4000, force: true }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
  const acceptAllCookies = page.getByRole("button", { name: /accept all cookies|^accept all$|^accept$/i }).first();
  if (await acceptAllCookies.count()) {
    await acceptAllCookies.click({ timeout: 4000, force: true }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
  const cookie = page.getByText(/^הבנתי$|^accept all$|^i understand$/i).first();
  if (await cookie.count()) {
    await cookie.click({ timeout: 2000 }).catch(() => undefined);
  }
  const close = page.locator("flashy-popup").locator(".fls-close");
  if (await close.count()) {
    await close.click({ timeout: 2000, force: true }).catch(() => undefined);
  }
  await page.evaluate(() => {
    document.querySelectorAll("flashy-popup").forEach((node) => node.remove());
  }).catch(() => undefined);
}

async function ensurePositionDetailPage(page: Page, role: string, targetUrl: string): Promise<void> {
  const positionMatch = page.url().match(/\/positions\/(\d+)/i)
    ?? targetUrl.match(/\/positions\/(\d+)/i);
  if (!positionMatch) {
    return;
  }
  const positionId = positionMatch[1];
  const roleKeyword = role.split(/\s+/).find((word) => word.length > 3) ?? role;
  const hasDetail = async (): Promise<boolean> => {
    if (await pageHasResumeField(page) || await pageHasApplyEmailField(page)) {
      return true;
    }
    const body = await page.locator("body").innerText().catch(() => "");
    return body.includes(roleKeyword) && !/showing \d+ positions/i.test(body);
  };
  if (await hasDetail()) {
    return;
  }
  await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  await page.waitForFunction(
    ({ keyword, id }) => {
      const text = document.body?.innerText ?? "";
      return text.includes(keyword) || Boolean(document.querySelector(`a[href*="${id}"]`));
    },
    { keyword: roleKeyword, id: positionId },
    { timeout: 20_000 },
  ).catch(() => undefined);
  if (await hasDetail()) {
    return;
  }
  const listView = await page.getByText(/showing \d+ positions/i).count().catch(() => 0);
  if (listView === 0) {
    return;
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const deepLink = page.locator(`a[href*="/positions/${positionId}"]`).first();
    if (await deepLink.count()) {
      await deepLink.click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      if (await hasDetail()) {
        return;
      }
    }
    const roleLink = page.locator("a[href*='/positions/']").filter({ hasText: new RegExp(roleKeyword, "i") }).first();
    if (await roleLink.count()) {
      await roleLink.click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      if (await hasDetail()) {
        return;
      }
    }
    const loadMore = page.getByRole("button", { name: /load more/i });
    if (!(await loadMore.count())) {
      break;
    }
    await loadMore.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
  }
}

async function revealApplyForm(page: Page): Promise<void> {
  if (await pageHasResumeField(page) || await pageHasApplyEmailField(page)) {
    return;
  }
  const applyLabel = /apply|הגש|מועמדות/i;
  const apply = page.getByRole("button", { name: applyLabel }).or(page.getByRole("link", { name: applyLabel })).first();
  if (await apply.count()) {
    const beforeUrl = page.url();
    const beforePages = new Set(page.context().pages());
    const href = await apply.getAttribute("href").catch(() => null);
    await Promise.all([
      page.waitForURL((url) => url.href !== beforeUrl, { timeout: 15_000 }).catch(() => undefined),
      apply.click({ timeout: 5000 }).catch(() => undefined),
    ]);
    await adoptPopup(page, beforePages);
    // Career sites sometimes swallow the click (sticky cookie layer). Follow the Apply href.
    if (href && /^https?:\/\//i.test(href) && page.url() === beforeUrl) {
      await page.goto(href, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await dismissOverlays(page);
    }
    await waitForApplyEntry(page, 15_000);
    await waitForGreenhouseFrame(page);
    return;
  }
  const beforePages = new Set(page.context().pages());
  const clicked = await page.evaluate(() => {
    const rule = /apply|הגש|מועמדות/i;
    const node = Array.from(document.querySelectorAll("a, button")).find((element) => rule.test((element.textContent || "").replace(/\s+/g, " ")));
    if (!node) {
      return false;
    }
    (node as HTMLElement).click();
    return true;
  }).catch(() => false);
  if (clicked) {
    await adoptPopup(page, beforePages);
    await waitForApplyEntry(page, 15_000);
  }
  await waitForGreenhouseFrame(page);
  await waitForResumeUploadTarget(page, 20_000).catch(() => undefined);
}

async function adoptPopup(page: Page, beforePages: Set<Page>): Promise<void> {
  const popup = page.context().pages().find((candidate) => !beforePages.has(candidate) && candidate !== page);
  if (!popup) {
    return;
  }
  await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
  const popupUrl = popup.url();
  if (/^https?:\/\//i.test(popupUrl)) {
    await page.goto(popupUrl, { waitUntil: "domcontentloaded" }).catch((error) => {
      log("APPLICATION_POPUP_ADOPT_FAILED", { popupUrl, message: error instanceof Error ? error.message : "navigation_failed" });
    });
  }
  await popup.close().catch(() => undefined);
}

async function waitForGreenhouseFrame(page: Page): Promise<void> {
  const frame = page.locator("iframe[src*='greenhouse'], iframe[src*='grnh.se'], iframe[id*='grnhse']").first();
  if (await frame.count().catch(() => 0)) {
    await frame.waitFor({ state: "attached", timeout: 12_000 }).catch(() => undefined);
    return;
  }
  const apply = page.getByRole("link", { name: /^apply/i }).or(page.getByRole("button", { name: /^apply/i })).first();
  if (await apply.count().catch(() => 0)) {
    await apply.click({ timeout: 5000 }).catch(() => undefined);
    await page.locator("iframe[src*='greenhouse'], iframe[src*='grnh.se']").first().waitFor({ state: "attached", timeout: 12_000 }).catch(() => undefined);
  }
}

async function waitForApplyEntry(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pageHasResumeField(page) || await pageHasApplyEmailField(page)) {
      return;
    }
    await page.waitForTimeout(250);
  }
}

async function retryGreenhouseSubmitAfterCaptcha(page: Page): Promise<void> {
  const frame = greenhouseJobAppFrame(page);
  if (!frame) {
    return;
  }
  await scrollGreenhouseFormIntoView(page);
  const submit = frame.getByRole("button", { name: /submit application/i }).first();
  if (await submit.count().catch(() => 0)) {
    await submit.click({ timeout: 10_000, force: true }).catch(() => undefined);
  }
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(8000);
  for (const ghFrame of page.frames()) {
    if (/greenhouse\.io/i.test(ghFrame.url())) {
      await ghFrame.waitForURL(/application_id=|greenhouse\.io/, { timeout: 12_000 }).catch(() => undefined);
      break;
    }
  }
}

async function pageHasApplyEmailField(page: Page): Promise<boolean> {
  return pageHasDeepEmailInput(page);
}

async function resolveGreenhouseEmailVerification(
  page: Page,
  scope: FormScope,
  input: ApplyInput,
  ctx: {
    persona: Persona;
    cvPublicFields: Omit<ApplicationResult, "jobUrl" | "status" | "submitted" | "confirmationDetected" | "notes">;
    filledAnswers: ApplicationResult["answers"];
    shotDir: string;
    screenshots: string[];
  },
): Promise<ApplicationResult | null> {
  const greenhouseAfter = greenhouseJobAppFrame(page) ? await inspectGreenhouseAfterSubmit(page) : null;
  if (greenhouseAfter?.kind !== "email_verification" && !(await detectEmailVerification(page))) {
    return null;
  }
  log("EMAIL_VERIFICATION_REQUIRED", { company: input.job.company, url: page.url() });
  const notBefore = new Date(Date.now() - 45_000).toISOString();
  const code = await pollGreenhouseOtp({
    mailbox: candidate.email,
    notBefore,
    company: input.job.company,
  });
  if (!code) {
    ctx.screenshots.push(await saveScreenshot(page, ctx.shotDir, "blocker.png"));
    return result(input, {
      status: "review",
      submitted: true,
      confirmationDetected: false,
      blocker: "email_verification_required",
      persona: ctx.persona,
      ...ctx.cvPublicFields,
      answers: ctx.filledAnswers,
      canonicalJobUrl: page.url(),
      notes: lines([
        "result=review",
        "blocker=email_verification_required",
        "Greenhouse asked for an email verification code. n8n Gmail OTP webhook returned no code in time.",
        "Check GREENHOUSE_OTP_WEBHOOK_URL and that the greenhouse-apply-otp workflow is active.",
      ]),
      screenshots: ctx.screenshots,
    });
  }
  const entered = await enterGreenhouseSecurityCode(page, code);
  if (!entered) {
    ctx.screenshots.push(await saveScreenshot(page, ctx.shotDir, "blocker.png"));
    return result(input, {
      status: "review",
      submitted: true,
      confirmationDetected: false,
      blocker: "email_verification_required",
      persona: ctx.persona,
      ...ctx.cvPublicFields,
      answers: ctx.filledAnswers,
      canonicalJobUrl: page.url(),
      notes: lines([
        "result=review",
        "blocker=email_verification_required",
        "OTP was fetched but the Security code field could not be filled.",
      ]),
      screenshots: ctx.screenshots,
    });
  }
  await dismissOverlays(page);
  await humanPause(page, 400, 900);
  const resubmit = await submitApplication(page, scope);
  log("GREENHOUSE_OTP_RESUBMIT", { clicked: resubmit.clicked, invalid: resubmit.invalid });
  if (!resubmit.clicked) {
    ctx.screenshots.push(await saveScreenshot(page, ctx.shotDir, "blocker.png"));
    return result(input, {
      status: "review",
      submitted: true,
      confirmationDetected: false,
      blocker: "email_verification_required",
      persona: ctx.persona,
      ...ctx.cvPublicFields,
      answers: ctx.filledAnswers,
      canonicalJobUrl: page.url(),
      notes: lines([
        "result=review",
        "blocker=email_verification_required",
        `otp_resubmit=${resubmit.invalid.join(",") || "not_clicked"}`,
        "The security code was typed, but Greenhouse did not enable Submit application.",
      ]),
      screenshots: ctx.screenshots,
    });
  }
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(6000);
  if (await detectEmailVerification(page)) {
    ctx.screenshots.push(await saveScreenshot(page, ctx.shotDir, "blocker.png"));
    return result(input, {
      status: "review",
      submitted: true,
      confirmationDetected: false,
      blocker: "email_verification_required",
      persona: ctx.persona,
      ...ctx.cvPublicFields,
      answers: ctx.filledAnswers,
      canonicalJobUrl: page.url(),
      notes: lines([
        "result=review",
        "blocker=email_verification_required",
        "OTP was entered but Greenhouse still shows the verification step.",
      ]),
      screenshots: ctx.screenshots,
    });
  }
  return null;
}

/** HTTP prefetch + fit for supported ATS URLs — skip the browser when the gate would reject anyway. */
async function preflightJobFit(input: ApplyInput): Promise<ApplicationResult | null> {
  const prefetched = await fetchPostingTextForFit(input.job.url);
  if (!prefetched) {
    return null;
  }
  const contentVerdict = classifyPostingContent(prefetched, input.job.url);
  if (postingContentBlocksFit(contentVerdict)) {
    return postingContentBlockedResult(input, contentVerdict, input.job.url, []);
  }
  let fit: JobFitResult;
  try {
    fit = await analyzeFullJobFit({
      role: input.job.role,
      company: input.job.company,
      jobText: prefetched,
      trackerCategory: input.job.category,
    });
  } catch (error) {
    log("JOB_FIT_PREFLIGHT_SKIPPED", {
      url: input.job.url,
      message: error instanceof Error ? error.message : "preflight_fit_failed",
    });
    return null;
  }
  log("JOB_FIT_PREFLIGHT", {
    url: input.job.url,
    score: fit.fitScore,
    decision: fit.decision,
    missingMustHaves: fit.missingMustHaves,
  });
  if (fit.decision === "apply" && fit.persona) {
    return null;
  }
  return result(input, {
    status: "not_relevant",
    terminalOutcome: "not_relevant",
    submitted: false,
    confirmationDetected: false,
    blocker: "full_job_fit_failed",
    canonicalJobUrl: input.job.url,
    notes: lines([
      "result=not_relevant",
      "reason=full_job_fit_failed",
      "preflight=true",
      `fit_score=${fit.fitScore}`,
      `missing_must_haves=${fit.missingMustHaves.join(", ") || "none"}`,
      `risks=${fit.risks.join(", ") || "none"}`,
      fit.reason,
      "Skipped opening the browser because the job description failed the fit gate (HTTP prefetch).",
    ]),
    screenshots: [],
  });
}

function statusForSubmissionScope(scope: SubmissionScope): ApplicationResult["status"] {
  if (scope === "agency_registration") {
    return "agency_registered";
  }
  if (scope === "agency_job_interest") {
    return "agency_job_referred";
  }
  return "applied";
}

function rememberManualApply(
  input: ApplyInput,
  extra: Pick<LedgerEntry, "blocker" | "cvPath" | "captchaSignal" | "stage" | "answers" | "canonicalJobUrl">,
): void {
  const agencyCtx = agencyContextFromUrl(input.job.url);
  rememberSubmission(enrichLedgerEntryForScope({
    url: input.job.url,
    company: input.job.company,
    role: input.job.role,
    confirmationDetected: false,
    at: new Date().toISOString(),
    ...extra,
  }, {
    url: input.job.url,
    workspaceId: input.workspaceId,
    scope: agencyCtx.intendedScope,
    agencyId: agencyCtx.agencyId,
    postingId: agencyCtx.postingId,
  }));
}

function result(input: ApplyInput, extra: Omit<ApplicationResult, "jobUrl">): ApplicationResult {
  return {
    jobUrl: input.job.url,
    attemptId: input.attemptId,
    pipeline: input.pipeline,
    recoveredFrom: input.recoveredFrom,
    ...extra,
  };
}

function postingContentBlockedResult(
  input: ApplyInput,
  verdict: ReturnType<typeof classifyPostingContent>,
  canonicalJobUrl: string,
  screenshots: string[],
): ApplicationResult {
  const blocker = verdict.kind === "search_results" || verdict.kind === "careers_directory"
    ? "non_specific_posting"
    : verdict.kind === "access_blocked"
      ? "access_blocked"
      : verdict.kind === "login_wall"
        ? "login_wall"
        : "job_description_unavailable";
  const status = verdict.kind === "search_results" || verdict.kind === "careers_directory"
    ? "not_relevant"
    : "review";
  const terminalOutcome = status === "not_relevant" ? "not_relevant" : "request_failed";
  log("POSTING_CONTENT_BLOCKED", {
    url: input.job.url,
    kind: verdict.kind,
    blocker,
    reason: verdict.reason,
  });
  return result(input, {
    status,
    terminalOutcome,
    submitted: false,
    confirmationDetected: false,
    blocker,
    canonicalJobUrl,
    notes: lines([
      status === "not_relevant" ? "result=not_relevant" : "result=review",
      `blocker=${blocker}`,
      `posting_content=${verdict.kind}`,
      verdict.reason,
      "Job fit was not evaluated because the page did not contain a complete job description.",
    ]),
    screenshots,
  });
}

type EarlyExit = { kind: "login_wall" } | { kind: "gone"; reason: string };

/** URL-only verdicts that make list recovery pointless. Only an UNRELATED domain counts as gone here; a hand-off to the company home stays recoverable. */
function earlyExitReason(originalUrl: string, landedUrl: string): EarlyExit | null {
  if (isLoginWallUrl(landedUrl)) {
    return { kind: "login_wall" };
  }
  const reason = redirectedAwayReason(originalUrl, landedUrl);
  return reason?.startsWith("redirected_away:") ? { kind: "gone", reason } : null;
}

async function loginWallResult(input: ApplyInput, screenshots: string[], landedOn: string): Promise<ApplicationResult> {
  rememberManualApply(input, { blocker: "login_required", canonicalJobUrl: input.job.url });
  return result(input, {
    status: "manual_required",
    submitted: false,
    confirmationDetected: false,
    blocker: "login_required",
    notes: lines([
      "result=manual_required",
      "blocker=login_required",
      `landed_on=${landedOn.split("?", 1)[0]}`,
      "The site shows a sign-in page instead of the job. Open the original link while signed in.",
    ]),
    screenshots,
  });
}

/**
 * A removed posting. The sheet keeps the ORIGINAL url (no canonicalJobUrl): the landing page of a dead link is a
 * careers home or a "not found" page, and saving it would erase the only evidence of which job this was.
 */
function closedResult(input: ApplyInput, screenshots: string[], detail: string, landedOn: string): ApplicationResult {
  return result(input, {
    status: "closed",
    submitted: false,
    confirmationDetected: false,
    notes: lines(["result=closed", "reason=job_removed", `landed_on=${landedOn.split("?", 1)[0]}`, detail]),
    screenshots,
  });
}

function locationIneligibleResult(input: ApplyInput, screenshots: string[], jobUrl: string, evidence: string): ApplicationResult {
  return result(input, {
    status: "location_ineligible",
    submitted: false,
    confirmationDetected: false,
    canonicalJobUrl: jobUrl,
    notes: lines([
      "result=not_relevant",
      "reason=location_ineligible",
      `location_evidence=${evidence}`,
      "Role must be remote or in Central/Tel Aviv District, and not in an excluded location. Nothing was submitted.",
    ]),
    screenshots,
  });
}

function lines(parts: string[]): string {
  return parts.join("\n");
}

function looksLikeGarbageListTitle(title: string): boolean {
  const cleaned = title.replace(/\s+/g, " ").trim();
  return cleaned.length < 8 || /^(page down|apply|view|learn more|next|previous)$/i.test(cleaned);
}

function bestTitleMatch(role: string, openings: { title: string; href: string }[]): { title: string; href: string } | null {
  const words = role.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  if (words.length === 0 || openings.length === 0) {
    return null;
  }
  let best: { title: string; href: string; hits: number } | null = null;
  for (const job of openings) {
    const hay = job.title.toLowerCase();
    const hits = words.filter((word) => hay.includes(word)).length;
    if (hits === 0) {
      continue;
    }
    if (!best || hits > best.hits) {
      best = { title: job.title, href: job.href, hits };
    }
  }
  if (!best || best.hits < Math.ceil(words.length / 2)) {
    return null;
  }
  return { title: best.title, href: best.href };
}

function watchApplyPost(page: Page): Promise<{ ok: boolean; phrase: string } | null> {
  return page.waitForResponse((response) => {
    const method = response.request().method();
    if (method !== "POST" && method !== "PUT") {
      return false;
    }
    if (response.status() >= 400) {
      return false;
    }
    const url = response.url();
    if (/analytics|segment|google-analytics|facebook|hotjar|sentry|doubleclick/i.test(url)) {
      return false;
    }
    return /apply|application|submit|candidate|comeet|smartrecruiters|oneclick-ui/i.test(url);
  }, { timeout: 25_000 }).then(async (response) => {
    const text = await response.text().catch(() => "");
    if (/captcha|validation error/i.test(text) && !/success|submitted|thank/i.test(text)) {
      return null;
    }
    return { ok: true, phrase: `apply_post_${response.status()}` };
  }).catch(() => null);
}

async function enterBestOpening(
  page: Page,
  role: string,
  company: string,
  targetUrl: string,
): Promise<{ title: string; line: string; blocked?: boolean; recovered?: boolean; outcome?: "not_relevant" | "review" | "location_ineligible"; canonicalUrl?: string } | null> {
  if (await pageHasResumeField(page)) {
    return null;
  }
  const positionIdFromTarget = careersPositionId(targetUrl);
  const greenhouseDirect = directGreenhouseUrlsForCareersUrl(targetUrl);
  if (positionIdFromTarget && greenhouseDirect.length > 0) {
    for (const directUrl of greenhouseDirect) {
      log("LISTING_GREENHOUSE_DIRECT", { company, positionId: positionIdFromTarget, url: directUrl });
      await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await dismissOverlays(page);
      if (await pageHasResumeField(page) || await pageHasApplyEmailField(page)) {
        return {
          title: role,
          recovered: true,
          line: `listing_match=${role}\nlisting_reason=greenhouse_direct=${positionIdFromTarget}`,
        };
      }
    }
  }
  let openings = await listOpenings(page, role);
  const boardSlug = greenhouseBoardSlug(targetUrl);
  if (boardSlug && listingsNeedGreenhouseApiFallback(openings, page.url())) {
    const apiOpenings = await fetchGreenhouseBoardOpenings(boardSlug);
    if (apiOpenings.length > 0) {
      log("LISTING_GREENHOUSE_API", { company, slug: boardSlug, count: apiOpenings.length });
      openings = apiOpenings;
    }
  }
  log("LISTING_OPENINGS_FOUND", { company, targetRole: role, count: openings.length, url: page.url() });
  const positionId = careersPositionId(targetUrl);
  if (positionId && openings.length > 0) {
    const byId = openings.filter((job) => openingMatchesPositionId(job, positionId));
    const targetPath = new URL(targetUrl).pathname.replace(/\/$/, "");
    const uniqueDeepLinks = byId.filter((job) => {
      if (looksLikeGarbageListTitle(job.title)) {
        return false;
      }
      try {
        return new URL(job.href).pathname.replace(/\/$/, "") === targetPath;
      } catch {
        return false;
      }
    });
    if (uniqueDeepLinks.length === 1) {
      const byIdJob = uniqueDeepLinks[0]!;
      log("LISTING_MATCH", { company, targetRole: role, title: byIdJob.title, href: byIdJob.href, reason: "url_position_id" });
      await openChosen(page, byIdJob);
      return {
        title: byIdJob.title,
        recovered: true,
        line: `listing_match=${byIdJob.title}\nlisting_reason=url_position_id=${positionId}`,
      };
    }
    if (uniqueDeepLinks.length === 0 && byId.length === 0) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    }
  }
  if (positionId && openings.length === 0) {
    const deepLink = page.locator(`a[href*="/positions/${positionId}"], a[href*="/jobs/${positionId}"]`).first();
    if (await deepLink.count()) {
      await deepLink.click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      return {
        title: role,
        line: `listing_match=${role}\nlisting_reason=clicked_position_id=${positionId}`,
      };
    }
  }
  if (openings.length === 0) {
    return null;
  }
  if (openings.length === 1) {
    const only = openings[0]!;
    const eligible = await resolveJobLocationEligible({ title: only.title, snippet: only.snippet, url: only.href });
    if (!eligible) {
      return {
        title: only.title,
        blocked: true,
        outcome: "location_ineligible",
        canonicalUrl: only.href,
        line: `Matched “${only.title}” but location is outside policy (or on the exclude list). Deep link saved.`,
      };
    }
    await openChosen(page, only);
    return {
      title: only.title,
      recovered: true,
      line: `listing_match=${only.title}\nlisting_reason=only_opening_on_list`,
    };
  }
  const locationChecks = await Promise.all(
    openings.map(async (job) => ({
      job,
      ok: await resolveJobLocationEligible({ title: job.title, snippet: job.snippet, url: job.href }),
    })),
  );
  const eligible = locationChecks.filter((row) => row.ok).map((row) => row.job);
  if (eligible.length === 0) {
    const titled = bestTitleMatch(role, openings);
    return {
      title: titled?.title ?? role,
      blocked: true,
      outcome: "location_ineligible",
      canonicalUrl: titled?.href,
      line: titled
        ? `Matched “${titled.title}” but location is outside policy (or on the exclude list). Deep link saved.`
        : "No opening on this list matches remote or Central/Tel Aviv District location policy.",
    };
  }
  let chosen: Awaited<ReturnType<typeof chooseOpening>>;
  try {
    chosen = await chooseOpening({ targetRole: role, company, openings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "listing_choice_failed";
    log("LISTING_NO_MATCH", { company, targetRole: role, reason: message });
    return { title: role, blocked: true, outcome: "review", line: `Could not judge the job list: ${message}` };
  }
  if (!chosen) {
    return {
      title: role,
      blocked: true,
      outcome: "not_relevant",
      line: "The link opened a list of jobs. No high-confidence title match (we do not force-apply to a loose substitute). Nothing was submitted.",
    };
  }
  await openChosen(page, chosen.job);
  return {
    title: chosen.job.title,
    recovered: true,
    line: `listing_match=${chosen.job.title}\nlisting_reason=${chosen.reason}`,
  };
}

async function tryGreenhouseCareersFallback(page: Page, targetUrl: string): Promise<void> {
  if (await pageHasResumeField(page) || await pageHasApplyEmailField(page)) {
    return;
  }
  const body = await page.locator("body").innerText().catch(() => "");
  const onList = /showing \d+ positions/i.test(body) || /find jobs|open positions/i.test(body);
  if (!onList && !/careers\.wix\.com/i.test(page.url())) {
    return;
  }
  const fallbacks = directGreenhouseUrlsForCareersUrl(targetUrl);
  if (fallbacks.length === 0) {
    return;
  }
  const returnUrl = page.url();
  for (const url of fallbacks) {
    log("CAREERS_GREENHOUSE_FALLBACK", { from: page.url(), target: url });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    await dismissOverlays(page);
    const landed = page.url();
    const html = await page.content().catch(() => "");
    if (/error=true/i.test(landed) || /no longer available|job not found|page not found/i.test(html)) {
      log("CAREERS_GREENHOUSE_FALLBACK_MISS", { target: url, landed });
      await page.goto(returnUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      continue;
    }
    await waitForGreenhouseFrame(page);
    if (await pageHasResumeField(page) || await pageHasApplyEmailField(page)) {
      return;
    }
  }
}

async function pageHasResumeField(page: Page): Promise<boolean> {
  return pageHasDeepFileInput(page);
}

/** Career-site chrome (search box) is not an application form — reject before CV upload. */
function looksLikeSiteChromeFields(fields: DetectedField[]): boolean {
  if (fields.length === 0) {
    return true;
  }
  const meaningful = fields.filter((field) => {
    const hint = `${field.label} ${field.name} ${field.id}`.replace(/\./g, "").trim();
    return hint.length > 0;
  });
  if (meaningful.length === 0) {
    return true;
  }
  const hasApplySignal = fields.some((field) => {
    const hint = `${field.label} ${field.name} ${field.id} ${field.type}`.toLowerCase();
    return field.type === "email"
      || field.type === "file"
      || field.type === "tel"
      || /resume|cv|curriculum|first.?name|last.?name|phone|email|linkedin|cover.?letter/i.test(hint);
  });
  if (hasApplySignal) {
    return false;
  }
  return fields.every((field) => {
    const hint = `${field.label} ${field.name} ${field.id}`.toLowerCase();
    return !hint.trim() || /find jobs|search|keywords|location|filter/i.test(hint);
  });
}

function todayJerusalem(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
}

function writeAudit(day: string, jobSlug: string, payload: unknown): void {
  const dir = `${env.auditDir}/${day}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/${jobSlug}.json`, JSON.stringify(payload, null, 2));
}
