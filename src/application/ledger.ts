import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { resolveLedgerPath } from "../orchestration/workspace-runtime.js";
import {
  isTerminalLedgerEntry,
  isTerminalManualBlocker,
  MANUAL_LEDGER_BLOCKERS,
  type LedgerEntry,
} from "./ledger-policy.js";

function ledgerFilePath(): string {
  return resolveLedgerPath(env.ledgerPath);
}

export type { LedgerEntry } from "./ledger-policy.js";
export {
  isTerminalLedgerEntry,
  isTerminalManualBlocker,
  MANUAL_LEDGER_BLOCKERS,
  TERMINAL_AUTO_BLOCKERS,
} from "./ledger-policy.js";

export function alreadySubmitted(url: string): boolean {
  return Boolean(priorTerminalEntry(url)?.confirmationDetected);
}

/** Prior confirmed send, or a terminal manual blocker (captcha / login). */
export function priorTerminalEntry(url: string): LedgerEntry | undefined {
  return readLedger()
    .filter((entry) => sameJobUrl(url, entry.url) || (entry.canonicalJobUrl ? sameJobUrl(url, entry.canonicalJobUrl) : false))
    .reverse()
    .find((entry) => isTerminalLedgerEntry(entry));
}

function sameJobUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = "";
    b.hash = "";
    a.pathname = a.pathname.replace(/\/+$/, "") || "/";
    b.pathname = b.pathname.replace(/\/+$/, "") || "/";
    return a.toString() === b.toString();
  } catch {
    return left.trim() === right.trim();
  }
}

export function rememberSubmission(entry: LedgerEntry): void {
  const filePath = ledgerFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

export function readLedger(): LedgerEntry[] {
  const filePath = ledgerFilePath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
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
