import fs from "node:fs";
import path from "node:path";
import { resolveApplyAttemptsPath, resolveLedgerPath } from "../orchestration/workspace-runtime.js";

/** Keep aligned with `DAILY_APPLY_BATCH_LIMIT` in discovery/queue-mix.ts (avoid import cycle). */
const DISCOVERY_QUEUE_BATCH_CAP = 20;

export type QuotaSnapshot = {
  day: string;
  confirmed: number;
  maxAttempts: number;
  attempted: number;
  attemptsRemaining: number;
  discoverySkipThreshold: number;
};

export const DISCOVERY_SKIP_NEW_MULTIPLIER = 3;

type QuotaRow = {
  day: string;
  at: string;
  url: string;
  status: string;
};

/** Only a confirmed send is counted for reporting; it no longer blocks applies. */
export function countsTowardDailyLimit(status: string): boolean {
  return status === "applied";
}

export function dailyApplyMaxAttempts(): number {
  const parsed = Number(process.env.DAILY_APPLY_MAX_ATTEMPTS ?? "1000");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1000;
  }
  return Math.floor(parsed);
}

export function quotaSnapshot(): QuotaSnapshot {
  const confirmed = countedToday();
  const maxAttempts = dailyApplyMaxAttempts();
  const attempted = attemptedToday();
  return {
    day: jerusalemDay(),
    confirmed,
    maxAttempts,
    attempted,
    attemptsRemaining: Math.max(0, maxAttempts - attempted),
    discoverySkipThreshold: DISCOVERY_SKIP_NEW_MULTIPLIER * DISCOVERY_QUEUE_BATCH_CAP,
  };
}

export function quotaIsOpen(): boolean {
  const snapshot = quotaSnapshot();
  return snapshot.attemptsRemaining > 0;
}

export function rememberQuotaUse(input: { url: string; status: string }): void {
  if (!countsTowardDailyLimit(input.status)) {
    return;
  }
  const row: QuotaRow = {
    day: jerusalemDay(),
    at: new Date().toISOString(),
    url: input.url,
    status: input.status,
  };
  const filePath = quotaLedgerPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function countedToday(): number {
  const day = jerusalemDay();
  const rows = readQuotaRows().filter((row) => row.day === day && countsTowardDailyLimit(row.status));
  const seen = new Set(rows.map((row) => row.url));
  for (const url of confirmedUrlsToday(day)) {
    if (!seen.has(url)) {
      seen.add(url);
    }
  }
  return seen.size;
}

function confirmedUrlsToday(day: string): string[] {
  const filePath = resolveLedgerPath(process.env.LEDGER_PATH?.trim() || "/app/data/ledger/applications.jsonl");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const urls: string[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed) as { url?: string; confirmationDetected?: boolean; at?: string };
      if (!entry.confirmationDetected || !entry.url || !entry.at) {
        continue;
      }
      if (jerusalemDay(new Date(entry.at)) !== day) {
        continue;
      }
      urls.push(entry.url);
    } catch {
      continue;
    }
  }
  return urls;
}

function attemptedToday(): number {
  const filePath = resolveApplyAttemptsPath(process.env.APPLY_ATTEMPTS_PATH?.trim() || "/app/data/ledger/apply-attempts.jsonl");
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const seen = new Set<string>();
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const row = JSON.parse(line) as { attemptId?: string; finishedAt?: string };
      if (row.attemptId && row.finishedAt && jerusalemDay(new Date(row.finishedAt)) === jerusalemDay()) {
        seen.add(row.attemptId);
      }
    } catch {
      continue;
    }
  }
  return seen.size;
}

function readQuotaRows(): QuotaRow[] {
  const filePath = quotaLedgerPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as QuotaRow];
      } catch {
        return [];
      }
    });
}

function quotaLedgerPath(): string {
  return process.env.QUOTA_LEDGER_PATH?.trim() || "/app/data/ledger/daily-quota.jsonl";
}

function jerusalemDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(date);
}
