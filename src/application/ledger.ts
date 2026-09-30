import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

import type { AnswerRecord } from "../models/types.js";

export type LedgerEntry = {
  url: string;
  company: string;
  role: string;
  confirmationDetected: boolean;
  at: string;
  cvPath?: string;
  blocker?: string;
  /** Only `active_challenge` is terminal for captcha; legacy rows without this field are not terminal. */
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
    return entry.captchaSignal === "active_challenge";
  }
  return false;
}

export function alreadySubmitted(url: string): boolean {
  return Boolean(priorTerminalEntry(url)?.confirmationDetected);
}

/** Prior confirmed send, or a terminal manual blocker (captcha / login). */
export function priorTerminalEntry(url: string): LedgerEntry | undefined {
  return readLedger()
    .filter((entry) => entry.url === url)
    .reverse()
    .find((entry) => entry.confirmationDetected || isTerminalManualBlocker(entry));
}

export function rememberSubmission(entry: LedgerEntry): void {
  fs.mkdirSync(path.dirname(env.ledgerPath), { recursive: true });
  fs.appendFileSync(env.ledgerPath, `${JSON.stringify(entry)}\n`);
}

function readLedger(): LedgerEntry[] {
  if (!fs.existsSync(env.ledgerPath)) {
    return [];
  }
  return fs.readFileSync(env.ledgerPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LedgerEntry];
      } catch {
        return [];
      }
    });
}
