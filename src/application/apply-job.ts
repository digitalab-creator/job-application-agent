import fs from "node:fs";
import type { BrowserContext, Page } from "playwright";
import { env } from "../config/env.js";
import { candidate } from "../config/candidate.js";
import { classifyJobPage } from "../application/classify-page.js";
import { fillFields, readFields, richestFormScope, uploadResume } from "../browser/form-filler.js";
import { withHeadlessBrowser } from "../browser/session.js";
import { saveScreenshot } from "../browser/screenshot.js";
import { buildCvDocument, CvGenerationError, writeCvPdf } from "../cv/generate.js";
import { choosePersonaFromText } from "../cv/persona-from-text.js";
import { portfolioFor } from "../cv/persona.js";
import { validateCv } from "../cv/validate.js";
import { log } from "../logging/logger.js";
import type { ApplicationResult, CvSource, Persona } from "../models/types.js";
import { alreadySubmitted, rememberSubmission } from "./ledger.js";
import { chooseSalary, publishedSalaryTooLow } from "./salary.js";
import { detectCaptcha, detectConfirmation, detectLoginWall } from "./verify-submission.js";

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
  if (input.submit && !input.ignoreLedger && alreadySubmitted(input.job.url)) {
    return result(input, {
      status: "review",
      submitted: false,
      confirmationDetected: false,
      blocker: "already_submitted",
      notes: lines(["result=review", "blocker=already_submitted", "Previous confirmation exists. Not submitted again."]),
      screenshots,
    });
  }

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(env.navigationTimeoutMs);
  page.setDefaultTimeout(env.actionTimeoutMs);
  try {
    await openJob(page, input.job.url);
    log("JOB_OPENED", { url: page.url(), company: input.job.company, role: input.job.role });
    screenshots.push(await saveScreenshot(page, shotDir, "job-page.png"));
    const bodyText = await page.locator("body").innerText();
    const pageStatus = classifyJobPage({
      url: page.url(),
      title: await page.title(),
      text: bodyText,
      role: input.job.role,
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
    if (pageStatus !== "ACTIVE_JOB") {
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: pageStatus.toLowerCase(),
        canonicalJobUrl: page.url(),
        notes: lines(["result=review", `blocker=${pageStatus.toLowerCase()}`, "Live page was not a specific open job."]),
        screenshots,
      });
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

    const persona = choosePersonaFromText(input.job.role, input.job.category ?? "", bodyText);
    const salaryMonthly = chooseSalary(input.job.role, persona);
    let cv;
    try {
      cv = await prepareCv(input, persona, bodyText, day, jobSlug);
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

    await revealApplyForm(page);
    if (await detectCaptcha(page)) {
      log("CAPTCHA_REQUIRED", { company: input.job.company });
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "captcha",
        persona,
        ...cv.publicFields,
        notes: lines(["result=review", "blocker=captcha", `cv=${persona}`, "Application prepared but CAPTCHA requires manual completion."]),
        screenshots,
      });
    }
    if (await detectLoginWall(page)) {
      screenshots.push(await saveScreenshot(page, shotDir, "blocker.png"));
      return result(input, {
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "login_required",
        persona,
        ...cv.publicFields,
        notes: lines(["result=review", "blocker=login_required", "Account creation is not handled in this version."]),
        screenshots,
      });
    }

    const scope = await richestFormScope(page);
    const fields = await readFields(scope);
    log("FORM_DETECTED", { fields: fields.map((field) => field.label) });
    if (fields.length === 0) {
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
      jobText: bodyText,
      ctx: {
        persona,
        salaryMonthly,
        portfolioUrl: candidate.portfolio[portfolioFor(persona)],
        euRole: /europe|eu\b|poland/i.test(bodyText),
      },
    });
    const uploaded = await uploadResume(scope, cv.cvPath);
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
        notes: lines(["result=review", "blocker=cv_upload_failed", "The PDF was not attached, so the form was not submitted."]),
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

    await humanPause(page, 800, 1600);
    await clickSubmit(page, scope);
    log("SUBMIT_CLICKED", { url: page.url() });
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(5000);
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
        status: "review",
        submitted: false,
        confirmationDetected: false,
        blocker: "captcha",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        notes: lines(["result=review", "blocker=captcha", "The site asked for a human validation task. The form is still open, so this was not submitted."]),
        screenshots,
      });
    }
    const confirmed = await detectConfirmation(page);
    screenshots.push(await saveScreenshot(page, shotDir, confirmed ? "confirmation.png" : "blocker.png"));
    if (!confirmed) {
      return result(input, {
        status: "review",
        submitted: true,
        confirmationDetected: false,
        blocker: "confirmation_not_detected",
        persona,
        ...cv.publicFields,
        answers: filled.answers,
        canonicalJobUrl: page.url(),
        notes: lines(["result=review", "blocker=confirmation_not_detected", "Submit was clicked but no confirmation was detected. Do not retry automatically."]),
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
        "ats=comeet",
        `salary_answer=${salaryMonthly}`,
        "confirmation=true",
      ]),
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
}> {
  const outputPath = `${env.generatedCvDir}/${day}/${jobSlug}-or-shvartz.pdf`;
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
    publicFields: {
      cvUsed,
      cvSource: "generated",
      cvWording: "llm",
      cvPath: outputPath,
      factIds: validation.factIds,
      ats: "comeet",
    },
  };
}

async function humanPause(page: Page, minMs: number, maxMs: number): Promise<void> {
  const wait = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  await page.waitForTimeout(wait);
}

async function openJob(page: Page, url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 80, undefined, { timeout: 20_000 }).catch(() => undefined);
      return;
    } catch (error) {
      lastError = error;
      log("NAVIGATION_RETRY", { attempt, url });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("navigation_failed");
}

async function revealApplyForm(page: Page): Promise<void> {
  const apply = page.getByRole("button", { name: /apply/i }).or(page.getByRole("link", { name: /apply/i })).first();
  if (await apply.count()) {
    await apply.click().catch(() => undefined);
    await page.locator('input[type="file"], input[type="email"]').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  }
}

async function clickSubmit(page: Page, scope: Awaited<ReturnType<typeof richestFormScope>>): Promise<void> {
  const named = /submit|send application/i;
  const inForm = scope.getByRole("button", { name: named }).first();
  if (await inForm.count()) {
    await inForm.click();
    return;
  }
  await page.getByRole("button", { name: named }).first().click();
}

function result(input: ApplyInput, extra: Omit<ApplicationResult, "jobUrl">): ApplicationResult {
  return { jobUrl: input.job.url, ...extra };
}

function lines(parts: string[]): string {
  return parts.join("\n");
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
