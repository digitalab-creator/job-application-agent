import fs from "node:fs";
import path from "node:path";

/** Longest expected single /apply (navigation retries + CV + submit). */
const LOCK_TTL_MS = 20 * 60 * 1000;

export type BrowserApplyLockResult = { ok: true } | { ok: false; reason: "apply_in_progress" };

/** One Playwright apply session at a time (persistent profile is not re-entrant). */
export function claimBrowserApply(): BrowserApplyLockResult {
  const file = lockPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, JSON.stringify({ startedAt: Date.now(), pid: process.pid }));
      fs.closeSync(fd);
      return { ok: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      if (!lockIsStale(file)) {
        return { ok: false, reason: "apply_in_progress" };
      }
      fs.unlinkSync(file);
    }
  }
  return { ok: false, reason: "apply_in_progress" };
}

export function releaseBrowserApply(): void {
  const file = lockPath();
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

export function browserApplyLockHeld(): boolean {
  const file = lockPath();
  if (!fs.existsSync(file)) {
    return false;
  }
  return !lockIsStale(file);
}

function lockIsStale(file: string): boolean {
  try {
    const row = JSON.parse(fs.readFileSync(file, "utf8")) as { startedAt?: number };
    if (typeof row.startedAt !== "number") {
      return true;
    }
    return Date.now() - row.startedAt >= LOCK_TTL_MS;
  } catch {
    return true;
  }
}

function lockPath(): string {
  return process.env.APPLY_BROWSER_LOCK_PATH?.trim() || "/app/data/ledger/apply-browser.lock";
}
