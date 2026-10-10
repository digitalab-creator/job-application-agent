import type { Page } from "playwright";
import { gotFriendsPostingIdFromUrl, type SubmissionScope } from "./submission-scope.js";
import { thankYouMatch } from "./thank-you.js";

export type GotFriendsFormEvidence = {
  scope: SubmissionScope;
  postingId: string | null;
  jobName: string | null;
  pageUrl: string | null;
  formId: string | null;
};

/** Prefer job-specific SideCvForm over site-wide CvFormGlobal on posting pages. */
export async function prepareGotFriendsJobApplyPage(page: Page): Promise<void> {
  if (!/gotfriends\.co\.il/i.test(page.url())) {
    return;
  }
  const postingId = gotFriendsPostingIdFromUrl(page.url());
  if (!postingId) {
    return;
  }
  await page.evaluate((expectedPosting) => {
    const side = document.querySelector("#SideCvForm");
    const jobNameInput = side?.querySelector('input[name="JobName"]') as HTMLInputElement | null;
    const matchesPosting = jobNameInput?.value === expectedPosting;
    if (!matchesPosting) {
      return;
    }
    for (const id of ["CvFormGlobal", "linkedInForm"]) {
      const form = document.querySelector(`#${id}`);
      if (!form) {
        continue;
      }
      form.querySelectorAll("input, button, textarea, select").forEach((el) => {
        (el as HTMLInputElement).disabled = true;
      });
    }
  }, postingId).catch(() => undefined);
}

export async function readGotFriendsFormEvidence(page: Page): Promise<GotFriendsFormEvidence | null> {
  if (!/gotfriends\.co\.il/i.test(page.url())) {
    return null;
  }
  return page.evaluate(() => {
    const side = document.querySelector("#SideCvForm");
    const sideJobName = (side?.querySelector('input[name="JobName"]') as HTMLInputElement | null)?.value?.trim() || "";
    const sidePageUrl = (side?.querySelector('input[name="PageUrl"]') as HTMLInputElement | null)?.value?.trim() || "";
    if (side && sideJobName) {
      return {
        scope: "agency_job_interest" as const,
        postingId: sideJobName,
        jobName: sideJobName,
        pageUrl: sidePageUrl || null,
        formId: "SideCvForm",
      };
    }
    const global = document.querySelector("#CvFormGlobal");
    const globalJobId = (global?.querySelector('input[name="jobId"]') as HTMLInputElement | null)?.value?.trim() || "";
    const globalJobName = (global?.querySelector('input[name="jobName"]') as HTMLInputElement | null)?.value?.trim() || "";
    if (global && !globalJobId && !globalJobName) {
      return {
        scope: "agency_registration" as const,
        postingId: null,
        jobName: null,
        pageUrl: (global.querySelector('input[name="pageUrl"]') as HTMLInputElement | null)?.value?.trim() || null,
        formId: "CvFormGlobal",
      };
    }
    const urlPosting = window.location.pathname.split("/").filter(Boolean).pop() || "";
    if (/^\d{5,7}$/.test(urlPosting)) {
      return {
        scope: "agency_job_interest" as const,
        postingId: urlPosting,
        jobName: urlPosting,
        pageUrl: window.location.pathname,
        formId: null,
      };
    }
    return {
      scope: "agency_registration" as const,
      postingId: null,
      jobName: null,
      pageUrl: null,
      formId: null,
    };
  }).catch(() => null);
}

export function resolveGotFriendsScopeFromEvidence(
  evidence: GotFriendsFormEvidence | null,
  jobUrl: string,
): SubmissionScope {
  if (evidence?.scope) {
    return evidence.scope;
  }
  const postingId = gotFriendsPostingIdFromUrl(jobUrl);
  return postingId ? "agency_job_interest" : "agency_registration";
}

export async function detectGotFriendsConfirmation(page: Page): Promise<{ ok: boolean; phrase: string }> {
  const chunks: string[] = [];
  chunks.push(await page.locator("body").innerText().catch(() => ""));
  for (const frame of page.frames()) {
    chunks.push(await frame.locator("body").innerText().catch(() => ""));
  }
  const text = chunks.join("\n");
  const hebrewCv = text.match(/קורות החיים[^\n]{0,120}(נשלחו|התקבלו|נקלטו)/i)?.[0];
  if (hebrewCv) {
    return { ok: true, phrase: hebrewCv.slice(0, 180) };
  }
  const phrase = thankYouMatch(text, page.url());
  if (phrase && !/thank you for visiting/i.test(text)) {
    return { ok: true, phrase };
  }
  if (/CompleteRegistration|fbq\s*\(\s*['"]track['"]\s*,\s*['"]CompleteRegistration/i.test(text)) {
    return { ok: false, phrase: "" };
  }
  return { ok: false, phrase: "" };
}
