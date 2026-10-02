import type { AnswerRecord } from "../models/types.js";

export type LedgerEntry = {
  url: string;
  company: string;
  role: string;
  confirmationDetected: boolean;
  at: string;
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

export function isTerminalManualBlocker(entry: LedgerEntry): boolean {
  if (entry.blocker === "login_required") {
    return true;
  }
  if (entry.blocker === "captcha") {
    return true;
  }
  return false;
}
