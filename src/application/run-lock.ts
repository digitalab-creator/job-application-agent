import fs from "node:fs";
import path from "node:path";

const LOCK_TTL_MS = 50 * 60 * 1000;

export type RunLockResult = { ok: true } | { ok: false; reason: string };

/** One apply workflow at a time per workspace (or global when workspaceId omitted). */
export function claimApplyRun(workspaceId?: string): RunLockResult {
  const file = lockPath(workspaceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, JSON.stringify({ startedAt: Date.now() }));
      fs.closeSync(fd);
      return { ok: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      if (!lockIsStale(file)) {
        return { ok: false, reason: "apply_run_in_progress" };
      }
      fs.unlinkSync(file);
    }
  }
  return { ok: false, reason: "apply_run_in_progress" };
}

export function releaseApplyRun(workspaceId?: string): { ok: true } {
  const file = lockPath(workspaceId);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  return { ok: true };
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

function lockPath(workspaceId?: string): string {
  const base = process.env.APPLY_RUN_LOCK_PATH?.trim() || "/app/data/ledger/apply-run.lock";
  if (!workspaceId?.trim()) {
    return base;
  }
  const dir = path.dirname(base);
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return path.join(dir, `apply-run-${safe}.lock`);
}
