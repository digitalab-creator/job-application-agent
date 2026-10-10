import type { AnswerRecord } from "../models/types.js";
import type { SubmissionScope } from "../models/types.js";

export type LedgerEntry = {
  url: string;
  company: string;
  role: string;
  confirmationDetected: boolean;
  at: string;
  submissionScope?: SubmissionScope;
  agencyId?: string;
  postingId?: string;
  dedupKey?: string;
  cvPath?: string;
  blocker?: string;
  /** Any explicit captcha blocker is terminal; the human queue owns the next attempt. */
  captchaSignal?: "passive_widget" | "active_challenge";
  stage?: "pre_submit" | "post_submit";
  canonicalJobUrl?: string;
  answers?: AnswerRecord[];
};

/** Blockers that mean auto-apply already decided "won't" — do not treat as fixable Review. */
export const MANUAL_LEDGER_BLOCKERS = new Set(["captcha", "login_required"]);

/** Submitted without confirmation — do not auto-retry until a human clears the ledger row. */
export const TERMINAL_AUTO_BLOCKERS = new Set([
  ...MANUAL_LEDGER_BLOCKERS,
  "submitted_unconfirmed",
]);

export function isTerminalManualBlocker(entry: LedgerEntry): boolean {
  if (entry.blocker === "login_required") {
    return true;
  }
  if (entry.blocker === "captcha") {
    return true;
  }
  return false;
}

export function isTerminalLedgerEntry(entry: LedgerEntry): boolean {
  if (entry.confirmationDetected) {
    return true;
  }
  if (entry.blocker && TERMINAL_AUTO_BLOCKERS.has(entry.blocker)) {
    return true;
  }
  return isTerminalManualBlocker(entry);
}
