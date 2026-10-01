import { candidate } from "../config/candidate.js";
import type { AnswerRecord } from "../models/types.js";
import { greenhouseJobPostUrls } from "./job-navigation-url.js";

/** Blockers where auto-apply stopped but a human can finish with CV + pasted answers. */
export const MANUAL_SHEET_BLOCKERS = new Set([
  "captcha",
  "login_required",
  "missing_fact",
  "form_validation",
  "cv_upload_failed",
  "submit_not_accepted",
  "confirmation_not_detected",
]);

export function shouldPromoteToManualSheet(outcome: {
  status: string;
  blocker?: string;
  cvPath?: string;
  answers?: AnswerRecord[];
}): boolean {
  if (outcome.status === "applied" || outcome.status === "manual_required") {
    return outcome.status === "manual_required";
  }
  if (!outcome.blocker || !MANUAL_SHEET_BLOCKERS.has(outcome.blocker)) {
    return false;
  }
  return Boolean(outcome.cvPath || (outcome.answers?.length ?? 0) > 0);
}

/** Sheet Notes payload: apply link, CV link, copy-paste fields (no browser console hacks). */
export function buildSheetManualNotes(input: {
  applyUrl: string;
  blocker?: string;
  cvPath?: string;
  cvDownloadUrl?: string;
  answers?: AnswerRecord[];
}): string {
  const embed = greenhouseJobPostUrls(input.applyUrl)[0] ?? input.applyUrl;
  const lines: string[] = [
    "result=manual_fill",
    input.blocker ? `blocker=${input.blocker}` : "blocker=manual",
    `apply=${embed}`,
  ];
  if (input.cvDownloadUrl) {
    lines.push(`cv=${input.cvDownloadUrl}`);
  } else if (input.cvPath) {
    lines.push(`cv_file=${input.cvPath}`);
  }
  lines.push("");
  lines.push("Paste into the form, attach CV, submit:");
  lines.push(`First Name: ${candidate.firstName}`);
  lines.push(`Last Name: ${candidate.lastName}`);
  lines.push(`Preferred First Name: ${candidate.firstName}`);
  lines.push(`Email: ${candidate.email}`);
  lines.push(`Phone: ${candidate.phone.display}`);
  lines.push(`Country: ${candidate.location.country}`);
  lines.push(`City: ${candidate.location.city}`);
  lines.push(`LinkedIn: ${candidate.linkedin}`);
  lines.push(`Website: ${candidate.portfolio.build}`);
  for (const row of input.answers ?? []) {
    const q = row.question.replace(/\*+$/, "").trim();
    if (!q || /first name|last name|preferred|email|phone|country|location \(city\)|linkedin|^website$/i.test(q)) {
      continue;
    }
    lines.push(`${q}: ${row.answer}`);
  }
  return lines.join("\n");
}

/** @deprecated Use buildSheetManualNotes */
export function buildManualFillGuide(input: Parameters<typeof buildSheetManualNotes>[0]): string {
  return buildSheetManualNotes(input);
}
