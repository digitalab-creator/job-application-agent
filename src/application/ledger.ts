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

export function alreadySubmitted(url: string): boolean {
  return readLedger().some((entry) => entry.url === url && (entry.confirmationDetected || entry.blocker === "captcha"));
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
