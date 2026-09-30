import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export type LedgerEntry = {
  url: string;
  company: string;
  role: string;
  confirmationDetected: boolean;
  at: string;
  cvPath?: string;
  blocker?: string;
};

/** Blockers that mean auto-apply already decided "won't" — do not treat as fixable Review. */
export const MANUAL_LEDGER_BLOCKERS = new Set(["captcha", "login_required"]);

export function alreadySubmitted(url: string): boolean {
  return Boolean(priorTerminalEntry(url)?.confirmationDetected);
}

/** Prior confirmed send, or a terminal manual blocker (captcha / login). */
export function priorTerminalEntry(url: string): LedgerEntry | undefined {
  return readLedger()
    .filter((entry) => entry.url === url)
    .reverse()
    .find((entry) => entry.confirmationDetected || (entry.blocker != null && MANUAL_LEDGER_BLOCKERS.has(entry.blocker)));
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
