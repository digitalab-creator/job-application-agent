import fs from "node:fs";
import path from "node:path";

export type QuotaSnapshot = {
  day: string;
  limit: number;
  counted: number;
  remaining: number;
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

/** Only a confirmed send uses a daily slot. Review and skips stay available for a later fix. */
export function countsTowardDailyLimit(status: string): boolean {
  return status === "applied";
}

export function dailyApplyLimit(): number {
  const parsed = Number(process.env.DAILY_APPLY_LIMIT ?? "20");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }
  return Math.floor(parsed);
}

export function dailyApplyMaxAttempts(): number {
  const parsed = Number(process.env.DAILY_APPLY_MAX_ATTEMPTS ?? "40");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 40;
  }
  return Math.floor(parsed);
}

export function quotaSnapshot(): QuotaSnapshot {
  const limit = dailyApplyLimit();
  const counted = countedToday();
  const maxAttempts = dailyApplyMaxAttempts();
  const attempted = attemptedToday();
  return {
    day: jerusalemDay(),
    limit,
    counted,
    remaining: Math.max(0, limit - counted),
    maxAttempts,
    attempted,
    attemptsRemaining: Math.max(0, maxAttempts - attempted),
    discoverySkipThreshold: DISCOVERY_SKIP_NEW_MULTIPLIER * limit,
  };
}

export function quotaIsOpen(): boolean {
  const snapshot = quotaSnapshot();
  return snapshot.remaining > 0 && snapshot.attemptsRemaining > 0;
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
  const filePath = process.env.LEDGER_PATH?.trim() || "/app/data/ledger/applications.jsonl";
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
  const filePath = process.env.APPLY_ATTEMPTS_PATH?.trim() || "/app/data/ledger/apply-attempts.jsonl";
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
