import fs from "node:fs";
import path from "node:path";

export type QuotaSnapshot = {
  day: string;
  limit: number;
  counted: number;
  remaining: number;
};

type QuotaRow = {
  day: string;
  at: string;
  url: string;
  status: string;
};

/** A removed or missing job must not use a daily slot. Every other finished attempt does. */
export function countsTowardDailyLimit(status: string): boolean {
  return status !== "closed" && status !== "quota_reached" && status !== "budget_reached";
}

export function dailyApplyLimit(): number {
  const parsed = Number(process.env.DAILY_APPLY_LIMIT ?? "20");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }
  return Math.floor(parsed);
}

export function quotaSnapshot(): QuotaSnapshot {
  const limit = dailyApplyLimit();
  const counted = countedToday();
  return {
    day: jerusalemDay(),
    limit,
    counted,
    remaining: Math.max(0, limit - counted),
  };
}

export function quotaIsOpen(): boolean {
  return quotaSnapshot().remaining > 0;
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
