import fs from "node:fs";
import type { BrowserContext, Page } from "playwright";
import { env } from "../config/env.js";
import { classifyJobPage } from "../application/classify-page.js";
import { applyFormScope, fillFields, readFields, uploadResume, waitForResumeUploadTarget, type DetectedField, type FormScope } from "../browser/form-filler.js";
import { candidate } from "../config/candidate.js";
import { enterGreenhouseSecurityCode, finalizeGreenhouseApplyForm, greenhouseJobAppFrame, inspectGreenhouseAfterSubmit, scrollGreenhouseFormIntoView } from "./greenhouse.js";
import { pollGreenhouseOtp } from "./greenhouse-otp-fetch.js";
import { navigationRetryUrls } from "./job-navigation-url.js";
import { submitApplication } from "../browser/submit-application.js";
import { withHeadlessBrowser } from "../browser/session.js";
import { saveScreenshot } from "../browser/screenshot.js";
import { buildCvDocument, CvGenerationError, writeCvPdf } from "../cv/generate.js";
import { choosePersonaFromText } from "../cv/persona-from-text.js";
import { portfolioUrlForDoc } from "../cv/portfolio.js";
import { validateCv } from "../cv/validate.js";
import { log } from "../logging/logger.js";
import type { ApplicationResult, CvSource, Persona } from "../models/types.js";
import { isExcludedApplyTarget } from "./exclude-company.js";
import { alreadySubmitted, priorTerminalEntry, rememberSubmission, MANUAL_LEDGER_BLOCKERS } from "./ledger.js";
import { chooseOpening, listOpenings, openChosen } from "./pick-opening.js";
import { chooseSalary, publishedSalaryTooLow } from "./salary.js";
import { resolveJobLocationEligible } from "../discovery/resolve-location-eligibility.js";
import { detectCaptcha, detectConfirmation, detectEmailVerification, detectLoginWall } from "./verify-submission.js";

export type ApplyInput = {
  row?: number;
  submit: boolean;
  ignoreLedger?: boolean;
  job: {
    role: string;
    company: string;
    url: string;
    matchScore?: number;
    category?: string;
    estimatedSalary?: string;
  };
};

export async function applyToJob(context: BrowserContext, input: ApplyInput): Promise<ApplicationResult> {
  const started = new Date().toISOString();
  const day = todayJerusalem();
  const jobSlug = slug(`${input.job.company}-${input.job.role}`);
  const shotDir = `${env.screenshotDir}/${day}/${jobSlug}`;
  const screenshots: string[] = [];
  if (!await resolveJobLocationEligible({ title: input.job.role, snippet: "", url: input.job.url })) {
    log("JOB_LOCATION_INELIGIBLE_PRECHECK", { role: input.job.role, url: input.job.url });
    return result(input, {
      status: "location_ineligible",
      submitted: false,
      confirmationDetected: false,
      notes: lines([
        "result=not_relevant",
        "reason=location_ineligible",
        "Role must be remote or in Israel Central District, and not in an excluded location. Nothing was submitted.",
      ]),
      screenshots,
    });
  }
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
    if (prior?.blocker && MANUAL_LEDGER_BLOCKERS.has(prior.blocker)) {
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

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(env.navigationTimeoutMs);
  page.setDefaultTimeout(env.actionTimeoutMs);
  try {
    try {
      await openJob(page, input.job.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "navigation_failed";
      log("JOB_NAVIGATION_FAILED", { url: input.job.url, message });
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
    log("JOB_OPENED", { url: page.url(), company: input.job.company, role: input.job.role });
    const listingNote = await enterBestOpening(page, input.job.role, input.job.company);
    screenshots.push(await saveScreenshot(page, shotDir, "job-page.png"));
    if (listingNote?.blocked) {
      if (listingNote.outcome === "location_ineligible") {
        return result(input, {
          status: "location_ineligible",
          submitted: false,
          confirmationDetected: false,
          canonicalJobUrl: page.url(),
          notes: lines(["result=not_relevant", "reason=location_ineligible", listingNote.line, "Nothing was submitted."]),
          screenshots,
        });
      }
      const skipped = listingNote.outcome === "not_relevant";
      return result(input, {
        status: skipped ? "not_relevant" : "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "no_matching_opening",
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
    const bodyText = await page.locator("body").innerText();
    const activeRole = listingNote?.title ?? input.job.role;
    const pageStatus = classifyJobPage({
      url: page.url(),
      title: await page.title(),
      text: bodyText,
      role: activeRole,
    });
    if (pageStatus === "CLOSED" || pageStatus === "NOT_FOUND") {
      log("JOB_CLOSED", { pageStatus });
      return result(input, {
        status: "closed",
        submitted: false,
        confirmationDetected: false,
        canonicalJobUrl: page.url(),
        notes: lines(["result=closed", "reason=job_removed", "Live check: job no longer available."]),
        screenshots,
      });
    }
    if (!await resolveJobLocationEligible({ title: activeRole, snippet: bodyText, url: page.url() })) {
      log("JOB_LOCATION_INELIGIBLE", { role: activeRole, url: page.url() });
      return result(input, {
        status: "location_ineligible",
        submitted: false,
        confirmationDetected: false,
        canonicalJobUrl: page.url(),
        notes: lines([
          "result=not_relevant",
          "reason=location_ineligible",
          "Role must be remote or in Israel Central District, and not in an excluded location. Nothing was submitted.",
        ]),
        screenshots,
      });
    }
    if (pageStatus === "CAREERS_PAGE") {
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "careers_page",
        canonicalJobUrl: page.url(),
        notes: lines(["result=review", "blocker=careers_page", listingNote?.line ?? "Live page was a careers list, not one job."]),
        screenshots,
      });
    }
    if (pageStatus === "UNKNOWN") {
      log("JOB_PAGE_UNCONFIRMED", { url: page.url(), company: input.job.company });
    }

    const salary = publishedSalaryTooLow(bodyText);
    if (salary.tooLow) {
      log("JOB_REJECTED_LOW_SALARY", { detail: salary.detail });
      return result(input, {
        status: "not_relevant",
        submitted: false,
        confirmationDetected: false,
        notes: lines(["result=not_relevant", "reason=salary_below_minimum", salary.detail, "Minimum accepted: ILS 21,000/month."]),
        screenshots,
      });
    }

    const persona = choosePersonaFromText(activeRole, input.job.category ?? "", bodyText);
    const salaryMonthly = chooseSalary(activeRole, persona);
    let cv;
    try {
      cv = await prepareCv({ ...input, job: { ...input.job, role: activeRole } }, persona, bodyText, day, jobSlug);
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
    log("CV_SELECTED", { persona, wording: cv.wording, source: cv.cvSource, path: cv.cvPath });

    await dismissOverlays(page);
    await revealApplyForm(page);
    await dismissOverlays(page);
    await page.evaluate(() => {
      document.querySelector("#application-form, .application--form, iframe[src*='greenhouse']")?.scrollIntoView({ block: "center" });
    }).catch(() => undefined);
    if (await detectCaptcha(page)) {
      log("CAPTCHA_REQUIRED", { company: input.job.company });
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      rememberSubmission({
        url: input.job.url,
        company: input.job.company,
        role: input.job.role,
        confirmationDetected: false,
        at: new Date().toISOString(),
        cvPath: cv.cvPath,
        blocker: "captcha",
      });
      return result(input, {
        status: "manual_required",
        submitted: false,
        confirmationDetected: false,
        blocker: "captcha",
        persona,
        ...cv.publicFields,
        notes: lines([
          "result=manual_required",
          "blocker=captcha",
          `cv=${persona}`,
          "CAPTCHA / human check blocks auto-apply. Finish manually in a browser if you want this job.",
        ]),
        screenshots,
      });
    }
    if (await detectLoginWall(page)) {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      rememberSubmission({
        url: input.job.url,
        company: input.job.company,
        role: input.job.role,
        confirmationDetected: false,
        at: new Date().toISOString(),
        cvPath: cv.cvPath,
        blocker: "login_required",
      });
      return result(input, {
        status: "manual_required",
        submitted: false,
        confirmationDetected: false,
        blocker: "login_required",
        persona,
        ...cv.publicFields,
        notes: lines([
          "result=manual_required",
          "blocker=login_required",
          "Apply opened an account / email login gate (often iCIMS). Account creation is not handled in this version.",
        ]),
        screenshots,
      });
    }

    const scope = await applyFormScope(page);
    const fields = await readFields(scope);
    log("FORM_DETECTED", { fields: fields.map((field) => field.label) });
    if (fields.length === 0 || looksLikeSiteChromeFields(fields)) {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "form_not_detected",
        persona,
        ...cv.publicFields,
        notes: lines(["result=review", "blocker=form_not_detected"]),
        screenshots,
      });
    }

    const filled = await fillFields({
      scope,
      fields,
      persona,
      ctx: {
        persona,
        salaryMonthly,
        portfolioUrl: cv.portfolioUrl,
        euRole: /europe|eu\b|poland/i.test(bodyText),
        company: input.job.company,
        role: activeRole,
      },
      jobText: jobBrief(bodyText),
    });
    const uploaded = await uploadResume(page, cv.cvPath);
    const greenhouseFrame = greenhouseJobAppFrame(page);
    if (greenhouseFrame) {
      await dismissOverlays(page);
      await finalizeGreenhouseApplyForm(greenhouseFrame).catch((error) => {
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
    const submitAttempt = await submitApplication(page, scope);
    log("SUBMIT_CLICKED", { url: page.url(), clicked: submitAttempt.clicked, invalid: submitAttempt.invalid });
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
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(8000);
    for (const frame of page.frames()) {
      if (/greenhouse\.io/i.test(frame.url())) {
        await frame.waitForURL(/application_id=|greenhouse\.io/, { timeout: 12_000 }).catch(() => undefined);
        break;
      }
    }
    const greenhouseAfter = greenhouseJobAppFrame(page) ? await inspectGreenhouseAfterSubmit(page) : null;
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
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      const validation = greenhouseAfter.kind === "validation";
      const why = greenhouseAfter.recaptcha === "challenge"
        ? "Greenhouse showed a visible reCAPTCHA challenge, so the application was not accepted."
        : validation
          ? "Greenhouse kept the form open and showed a validation error. The application was not accepted."
          : "The Submit application button is still on the form. The click did not leave the application form.";
      const blocker = greenhouseAfter.recaptcha === "challenge" ? "captcha" : validation ? "form_validation" : "submit_not_accepted";
      if (blocker === "captcha") {
        rememberSubmission({
          url: input.job.url,
          company: input.job.company,
          role: input.job.role,
          confirmationDetected: false,
          at: new Date().toISOString(),
          cvPath: cv.cvPath,
          blocker: "captcha",
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
    if (await detectCaptcha(page)) {
      log("CAPTCHA_REQUIRED", { company: input.job.company, stage: "after_submit" });
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      rememberSubmission({
        url: input.job.url,
        company: input.job.company,
        role: input.job.role,
        confirmationDetected: false,
        at: new Date().toISOString(),
        cvPath: cv.cvPath,
        blocker: "captcha",
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
          "The site asked for a human validation task. The form is still open — finish manually if you want this job.",
        ]),
        screenshots,
      });
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
    const confirmed = await detectConfirmation(page);
    screenshots.push(await saveScreenshot(page, shotDir, confirmed.ok ? "confirmation.png" : "blocker.png"));
    if (!confirmed.ok) {
      return result(input, {
        status: "review",
        submitted: true,
        confirmationDetected: false,
        blocker: "confirmation_not_detected",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        canonicalJobUrl: page.url(),
        notes: lines(["result=review", "blocker=confirmation_not_detected", "Submit was sent but no confirmation was detected. Do not retry automatically."]),
        screenshots,
      });
    }
    log("SUBMISSION_CONFIRMED", { company: input.job.company, role: input.job.role });
    const appliedAt = new Date().toISOString();
    rememberSubmission({
      url: input.job.url,
      company: input.job.company,
      role: input.job.role,
      confirmationDetected: true,
      at: appliedAt,
      cvPath: cv.cvPath,
    });
    writeAudit(day, jobSlug, { started, input, persona, cv, answers: filled.answers, appliedAt });
    return result(input, {
      status: "applied",
      submitted: true,
      confirmationDetected: true,
      appliedAt,
      persona,
      ...cv.publicFields,
      answers: filled.answers,
      canonicalJobUrl: page.url(),
      notes: lines([
        "AUTO_APPLY",
        "result=applied",
        `cv=${cv.publicFields.cvUsed}`,
        `cv_source=${cv.cvSource}`,
        `ats=${atsLabel(input.job.url)}`,
        `salary_answer=${salaryMonthly}`,
        "confirmation=true",
        `confirmation_text=${confirmed.phrase}`,
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
  day: string,
  jobSlug: string,
): Promise<{
  cvPath: string;
  cvSource: CvSource;
  wording: "llm";
  publicFields: Pick<ApplicationResult, "cvUsed" | "cvSource" | "cvWording" | "cvPath" | "factIds" | "ats">;
  portfolioUrl: string;
}> {
  const outputPath = `${env.generatedCvDir}/${day}/${jobSlug}-redacted-candidate.pdf`;
  const built = await buildCvDocument({
    persona,
    role: input.job.role,
    company: input.job.company,
    jobText,
  });
  const validation = validateCv(built.doc, persona);
  if (!validation.ok) {
    throw new CvGenerationError(validation.errors.join("; "));
  }
  await withHeadlessBrowser((browser) => writeCvPdf(browser, built.doc, persona, outputPath));
  const cvUsed = built.doc.headlineId === "marketing-full" ? "marketing" : "technical";
  return {
    cvPath: outputPath,
    cvSource: "generated",
    wording: "llm",
    portfolioUrl: portfolioUrlForDoc(built.doc, persona),
    publicFields: {
      cvUsed,
      cvSource: "generated",
      cvWording: "llm",
      cvPath: outputPath,
      factIds: validation.factIds,
      ats: atsLabel(input.job.url),
    },
  };
}

async function humanPause(page: Page, minMs: number, maxMs: number): Promise<void> {
  const wait = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  await page.waitForTimeout(wait);
}

async function openJob(page: Page, url: string): Promise<void> {
  let lastError: unknown;
  const targets = navigationRetryUrls(url);
  for (const target of targets) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      for (const waitUntil of ["domcontentloaded", "commit"] as const) {
        try {
          await page.goto(target, { waitUntil });
          await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 80, undefined, { timeout: 20_000 }).catch(() => undefined);
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

async function revealApplyForm(page: Page): Promise<void> {
  if (await pageHasResumeField(page) || await pageHasApplyEmailField(page)) {
    return;
  }
  const applyLabel = /apply|הגש|מועמדות/i;
  const apply = page.getByRole("button", { name: applyLabel }).or(page.getByRole("link", { name: applyLabel })).first();
  if (await apply.count()) {
    const beforeUrl = page.url();
    const href = await apply.getAttribute("href").catch(() => null);
    await Promise.all([
      page.waitForURL((url) => url.href !== beforeUrl, { timeout: 15_000 }).catch(() => undefined),
      apply.click({ timeout: 5000 }).catch(() => undefined),
    ]);
    // Career sites sometimes swallow the click (sticky cookie layer). Follow the Apply href.
    if (href && /^https?:\/\//i.test(href) && page.url() === beforeUrl) {
      await page.goto(href, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await dismissOverlays(page);
    }
    await waitForApplyEntry(page, 15_000);
    return;
  }
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
    await waitForApplyEntry(page, 15_000);
  }
  await waitForResumeUploadTarget(page, 20_000).catch(() => undefined);
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

async function pageHasApplyEmailField(page: Page): Promise<boolean> {
  for (const scope of [page, ...page.frames()]) {
    const count = await scope.locator('input[type="email"]').count().catch(() => 0);
    if (count > 0) {
      return true;
    }
  }
  return false;
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

function result(input: ApplyInput, extra: Omit<ApplicationResult, "jobUrl">): ApplicationResult {
  return { jobUrl: input.job.url, ...extra };
}

function lines(parts: string[]): string {
  return parts.join("\n");
}

async function enterBestOpening(
  page: Page,
  role: string,
  company: string,
): Promise<{ title: string; line: string; blocked?: boolean; outcome?: "not_relevant" | "review" | "location_ineligible" } | null> {
  if (await pageHasResumeField(page)) {
    return null;
  }
  const openings = await listOpenings(page);
  if (openings.length < 2) {
    return null;
  }
  const locationChecks = await Promise.all(
    openings.map(async (job) => ({
      job,
      ok: await resolveJobLocationEligible({ title: job.title, snippet: job.snippet, url: job.href }),
    })),
  );
  const eligible = locationChecks.filter((row) => row.ok).map((row) => row.job);
  if (eligible.length === 0) {
    return {
      title: role,
      blocked: true,
      outcome: "location_ineligible",
      line: "No opening on this list matches remote or Central District location policy.",
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
      line: "The link opened a list of jobs. None was a good match, so no application was sent.",
    };
  }
  await openChosen(page, chosen.job);
  return {
    title: chosen.job.title,
    line: `listing_match=${chosen.job.title}\nlisting_reason=${chosen.reason}`,
  };
}

async function pageHasResumeField(page: Page): Promise<boolean> {
  const scopes = [page, ...page.frames()];
  for (const scope of scopes) {
    const count = await scope.locator('input[type="file"]').count().catch(() => 0);
    if (count > 0) {
      return true;
    }
  }
  return false;
}

/** Career-site chrome (search box) is not an application form — reject before CV upload. */
function looksLikeSiteChromeFields(fields: DetectedField[]): boolean {
  if (fields.length === 0) {
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
