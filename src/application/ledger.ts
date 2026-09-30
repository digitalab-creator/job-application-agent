import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import {
  isTerminalManualBlocker,
  MANUAL_LEDGER_BLOCKERS,
  type LedgerEntry,
} from "./ledger-policy.js";

export type { LedgerEntry } from "./ledger-policy.js";
export { isTerminalManualBlocker, MANUAL_LEDGER_BLOCKERS } from "./ledger-policy.js";

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
