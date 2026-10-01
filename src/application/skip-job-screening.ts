import { isOfficeCommuteQuestion, officeCommuteAnswerYes } from "./office-commute.js";

export const OFFICE_COMMUTE_SKIP_REASON =
  "Office commute is outside pursue geography (Central / Tel Aviv District only).";

/** Whole-job skip when posting or form screening names an office we will not commute to. */
export function matchesOfficeCommuteSkip(text: string): boolean {
  const blob = text.replace(/\s+/g, " ").trim();
  if (!blob) {
    return false;
  }
  const commuteQuestion = isOfficeCommuteQuestion(blob)
    || /days?\s+(?:a|per)\s+week\s+(?:in|at)\s+(?:the\s+)?office/i.test(blob);
  if (!commuteQuestion) {
    return false;
  }
  return !officeCommuteAnswerYes(blob, blob);
}

export function declineReasonFromFieldLabels(labels: string[]): string | null {
  for (const label of labels) {
    if (matchesOfficeCommuteSkip(label)) {
      return `${OFFICE_COMMUTE_SKIP_REASON} Question: "${label.slice(0, 120)}"`;
    }
  }
  return null;
}
