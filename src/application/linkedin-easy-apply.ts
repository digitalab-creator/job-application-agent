import type { Page } from "playwright";
import { log } from "../logging/logger.js";
import { candidate } from "../config/candidate.js";
import {
  hostIsCooling,
  linkedinEasyApplyRemaining,
  looksLikeRateLimit,
  noteLinkedInEasyApply,
  noteRateLimit,
} from "./rate-limit.js";
import type { ApplyInput } from "./apply-job.js";
import type { ApplicationResult } from "../models/types.js";

export function isLinkedInJobUrl(url: string): boolean {
  return /linkedin\.com\/jobs\/view\//i.test(url);
}

/** Any LinkedIn host, including the sign-in wall. The kill switch uses this, not only Easy Apply URLs. */
export function isLinkedInHost(url: string): boolean {
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname);
  } catch {
    return /linkedin\.com/i.test(url);
  }
}

/**
 * Easy Apply stays off unless LINKEDIN_EASY_APPLY_ENABLED is exactly true, 1, or yes.
 * Unset means off, so a deploy cannot touch the LinkedIn account by accident.
 */
export function linkedinEasyApplyEnabled(): boolean {
  const raw = (process.env.LINKEDIN_EASY_APPLY_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function linkedinFeatureDisabledResult(jobUrl: string): ApplicationResult {
  return {
    status: "review",
    jobUrl,
    submitted: false,
    confirmationDetected: false,
    blocker: "feature_disabled",
    notes: [
      "result=review",
      "blocker=feature_disabled",
      "LinkedIn Easy Apply is off. Set LINKEDIN_EASY_APPLY_ENABLED=true to turn it on. The browser was not opened.",
    ].join("\n"),
  };
}

/**
 * Drive LinkedIn Easy Apply when the button exists.
 * Returns null when this page is not an Easy Apply job (caller continues).
 */
export async function runLinkedInEasyApply(
  page: Page,
  input: ApplyInput,
  cvPath: string | undefined,
): Promise<ApplicationResult | null> {
  if (!isLinkedInJobUrl(page.url()) && !isLinkedInJobUrl(input.job.url)) {
    return null;
  }
  if (!linkedinEasyApplyEnabled()) {
    log("LINKEDIN_EASY_APPLY_DISABLED", { url: input.job.url });
    return linkedinFeatureDisabledResult(input.job.url);
  }
  if (hostIsCooling(page.url() || input.job.url)) {
    return base(input, {
      status: "review",
      blocker: "rate_limited",
      notes: "LinkedIn is in cooldown after a rate limit. The agent will retry after the backoff.",
    });
  }
  if (linkedinEasyApplyRemaining() <= 0) {
    noteRateLimit("linkedin.com", "daily_easy_apply_cap");
    return base(input, {
      status: "quota_reached",
      blocker: "quota_reached",
      notes: "LinkedIn Easy Apply daily cap reached. Agent paused this host until tomorrow.",
    });
  }
  const body = await page.locator("body").innerText().catch(() => "");
  if (looksLikeRateLimit(body)) {
    noteRateLimit(page.url(), "linkedin_rate_limit_copy");
    return base(input, {
      status: "review",
      blocker: "rate_limited",
      notes: "LinkedIn showed a rate-limit or checkpoint message. Cooldown started.",
    });
  }
  if (/sign in|join now/i.test(body) && await page.locator("input#username, input[name='session_key']").count()) {
    const loggedIn = await tryLinkedInLogin(page);
    if (!loggedIn) {
      return base(input, {
        status: "manual_required",
        blocker: "login_required",
        notes: "LinkedIn session missing. Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD (workspace secrets) or log in once in the persistent browser profile.",
      });
    }
  }
  const easy = page.getByRole("button", { name: /easy apply/i });
  if (await easy.count() === 0) {
    return null;
  }
  await easy.first().click();
  await page.waitForTimeout(1500);
  for (let step = 0; step < 6; step += 1) {
    await fillEasyApplyStep(page, cvPath);
    const submit = page.getByRole("button", { name: /submit application/i });
    if (await submit.count()) {
      if (!input.submit) {
        return base(input, {
          status: "review",
          blocker: "dry_run",
          notes: "LinkedIn Easy Apply modal filled. Submit was not clicked (dry run).",
        });
      }
      await submit.first().click();
      await page.waitForTimeout(2500);
      const after = await page.locator("body").innerText().catch(() => "");
      if (looksLikeRateLimit(after)) {
        noteRateLimit(page.url(), "linkedin_post_submit_rate_limit");
        return base(input, {
          status: "review",
          blocker: "rate_limited",
          notes: "LinkedIn rate-limited after submit. Cooldown started; not marked Applied.",
        });
      }
      const confirmed = /application submitted|application sent|your application was sent/i.test(after);
      if (confirmed) {
        noteLinkedInEasyApply();
        return base(input, {
          status: "applied",
          submitted: true,
          confirmationDetected: true,
          notes: "result=applied\nats=linkedin_easy_apply\nLinkedIn showed an application-submitted confirmation.",
        });
      }
      return base(input, {
        status: "manual_required",
        submitted: true,
        blocker: "submitted_unconfirmed",
        notes: "Easy Apply submit clicked but LinkedIn confirmation text was not detected.",
      });
    }
    const next = page.getByRole("button", { name: /^(next|review|continue)$/i });
    if (await next.count() === 0) {
      break;
    }
    await next.first().click();
    await page.waitForTimeout(1200);
  }
  return base(input, {
    status: "review",
    blocker: "form_not_detected",
    notes: "Easy Apply opened but the modal did not reach Submit.",
  });
}

async function tryLinkedInLogin(page: Page): Promise<boolean> {
  const email = process.env.LINKEDIN_EMAIL?.trim();
  const password = process.env.LINKEDIN_PASSWORD?.trim();
  if (!email || !password) {
    log("LINKEDIN_LOGIN_MISSING_SECRETS", {});
    return false;
  }
  const user = page.locator("input#username, input[name='session_key']").first();
  const pass = page.locator("input#password, input[name='session_password']").first();
  if (await user.count() === 0) {
    return false;
  }
  await user.fill(email);
  await pass.fill(password);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText().catch(() => "");
  if (looksLikeRateLimit(body) || /checkpoint|captcha|security verification/i.test(body)) {
    noteRateLimit("linkedin.com", "login_checkpoint");
    return false;
  }
  return !/sign in/i.test(body) || await page.locator("input#username").count() === 0;
}

async function fillEasyApplyStep(page: Page, cvPath?: string): Promise<void> {
  const phone = page.locator("input[id*='phoneNumber'], input[name*='phone']").first();
  if (await phone.count()) {
    const current = await phone.inputValue().catch(() => "");
    if (!current.trim()) {
      await phone.fill(candidate.phone.local);
    }
  }
  if (cvPath) {
    const file = page.locator("input[type='file']").first();
    if (await file.count()) {
      await file.setInputFiles(cvPath).catch(() => undefined);
    }
  }
}

function base(
  input: ApplyInput,
  patch: Partial<ApplicationResult> & { notes: string },
): ApplicationResult {
  return {
    attemptId: input.attemptId,
    status: patch.status ?? "review",
    jobUrl: input.job.url,
    submitted: patch.submitted ?? false,
    confirmationDetected: patch.confirmationDetected ?? false,
    blocker: patch.blocker,
    notes: patch.notes,
    terminalOutcome: patch.confirmationDetected ? "applied" : undefined,
  };
}
