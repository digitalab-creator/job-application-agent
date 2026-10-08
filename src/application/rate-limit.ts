import fs from "node:fs";
import path from "node:path";
import { log } from "../logging/logger.js";

export type HostRateState = {
  host: string;
  strikes: number;
  cooldownUntil: string;
  lastReason: string;
  linkedinEasyApplyToday?: number;
  linkedinDay?: string;
  updatedAt: string;
};

const MIN_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 6 * 60 * 60_000;

function storePath(): string {
  return process.env.RATE_LIMIT_STORE_PATH?.trim() || "/app/data/ledger/rate-limits.json";
}

function readAll(): Record<string, HostRateState> {
  const file = storePath();
  try {
    if (!fs.existsSync(file)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, HostRateState>;
  } catch (error) {
    log("RATE_LIMIT_READ_FAILED", { message: error instanceof Error ? error.message : "read_failed" });
    return {};
  }
}

function writeAll(rows: Record<string, HostRateState>): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "unknown";
  }
}

export function hostIsCooling(urlOrHost: string, now = Date.now()): boolean {
  const host = urlOrHost.includes("://") ? hostFromUrl(urlOrHost) : urlOrHost.toLowerCase();
  const row = readAll()[host];
  if (!row?.cooldownUntil) {
    return false;
  }
  return Date.parse(row.cooldownUntil) > now;
}

/** Remember a pushback (429, checkpoint, unsolved CAPTCHA) and stretch the cooldown. */
export function noteRateLimit(urlOrHost: string, reason: string): HostRateState {
  const host = urlOrHost.includes("://") ? hostFromUrl(urlOrHost) : urlOrHost.toLowerCase();
  const all = readAll();
  const prev = all[host];
  const strikes = (prev?.strikes ?? 0) + 1;
  const cooldownMs = Math.min(MAX_COOLDOWN_MS, MIN_COOLDOWN_MS * 2 ** Math.min(strikes, 8));
  const row: HostRateState = {
    host,
    strikes,
    cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
    lastReason: reason.slice(0, 240),
    linkedinEasyApplyToday: prev?.linkedinEasyApplyToday,
    linkedinDay: prev?.linkedinDay,
    updatedAt: new Date().toISOString(),
  };
  all[host] = row;
  writeAll(all);
  log("RATE_LIMIT_NOTED", { host, strikes, cooldownUntil: row.cooldownUntil, reason: row.lastReason });
  return row;
}

export function noteHostSuccess(urlOrHost: string): void {
  const host = urlOrHost.includes("://") ? hostFromUrl(urlOrHost) : urlOrHost.toLowerCase();
  const all = readAll();
  const prev = all[host];
  if (!prev) {
    return;
  }
  all[host] = {
    ...prev,
    strikes: Math.max(0, prev.strikes - 1),
    cooldownUntil: new Date(0).toISOString(),
    lastReason: "success_decay",
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
  log("RATE_LIMIT_DECAY", { host, strikes: all[host].strikes });
}

export function linkedinEasyApplyRemaining(day = jerusalemDay()): number {
  const max = Math.max(1, Number(process.env.LINKEDIN_EASY_APPLY_DAILY_MAX ?? "10") || 10);
  const row = readAll()["linkedin.com"];
  const used = row?.linkedinDay === day ? row.linkedinEasyApplyToday ?? 0 : 0;
  return Math.max(0, max - used);
}

export function noteLinkedInEasyApply(day = jerusalemDay()): void {
  const all = readAll();
  const prev = all["linkedin.com"];
  const used = prev?.linkedinDay === day ? prev.linkedinEasyApplyToday ?? 0 : 0;
  all["linkedin.com"] = {
    host: "linkedin.com",
    strikes: prev?.strikes ?? 0,
    cooldownUntil: prev?.cooldownUntil ?? new Date(0).toISOString(),
    lastReason: prev?.lastReason ?? "easy_apply",
    linkedinDay: day,
    linkedinEasyApplyToday: used + 1,
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
  log("LINKEDIN_EASY_APPLY_COUNTED", { day, count: used + 1 });
}

function jerusalemDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

export function looksLikeRateLimit(text: string): boolean {
  return /too many requests|rate limit|429|unusual activity|try again later|slow down|temporarily restricted/i.test(text);
}
