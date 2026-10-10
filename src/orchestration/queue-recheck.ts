import fs from "node:fs";
import path from "node:path";
import { browserApplyLockHeld } from "../application/browser-apply-lock.js";
import { resolveApplyCapability } from "../application/ats-capability.js";
import { inspectJobUrls } from "../application/link-liveness.js";
import {
  PRESERVE_QUEUE_STATUSES,
  recoverCanonicalJobUrls,
  recommendQueueStatus,
} from "../application/queue-sheet-verdict.js";
import { isSpecificJobUrl } from "../application/url-inspector.js";
import { log } from "../logging/logger.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { readJobSheetRows, updateJobSheetRows, type JobSheetRow } from "./sheets/job-sheet.js";

const DEFAULT_LIMIT = 60;
const LOCK_TTL_MS = 25 * 60 * 1000;

export type QueueRecheckRowResult = {
  row_number: number;
  company?: string;
  role?: string;
  previousStatus?: string;
  recommendedStatus?: string;
  reason?: string;
  evidence?: string;
  applied: boolean;
  skipped?: string;
};

export type QueueRecheckResult = {
  status: "ok" | "skipped" | "error";
  dryRun: boolean;
  scanned: number;
  changed: number;
  summary: Record<string, number>;
  rows: QueueRecheckRowResult[];
  auditPath?: string;
};

function lockPath(): string {
  return path.join(process.cwd(), "data", "locks", "queue-recheck.lock");
}

function claimRecheckLock(): boolean {
  const file = lockPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeFileSync(fd, JSON.stringify({ startedAt: Date.now(), pid: process.pid }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") {
      throw error;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { startedAt?: number };
      if (Date.now() - (raw.startedAt ?? 0) > LOCK_TTL_MS) {
        fs.unlinkSync(file);
        return claimRecheckLock();
      }
    } catch {
      fs.unlinkSync(file);
      return claimRecheckLock();
    }
    return false;
  }
}

function releaseRecheckLock(): void {
  const file = lockPath();
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function rowIsNonempty(row: JobSheetRow): boolean {
  const status = String(row.Status ?? "").trim();
  const url = String(row["Job URL"] ?? "").trim();
  const company = String(row.Company ?? "").trim();
  const role = String(row.Role ?? "").trim();
  return Boolean(status || url || company || role);
}

function prioritizeRows(rows: JobSheetRow[], statuses: string[]): JobSheetRow[] {
  const wanted = new Set(statuses.map((s) => s.trim()).filter(Boolean));
  const eligible = rows.filter((row) => {
    if (!row.row_number || !rowIsNonempty(row)) {
      return false;
    }
    const status = String(row.Status ?? "").trim();
    if (PRESERVE_QUEUE_STATUSES.has(status)) {
      return false;
    }
    if (wanted.size === 0) {
      return true;
    }
    return wanted.has(status);
  });

  const rank = (status: string): number => {
    if (status === "Manual") {
      return 0;
    }
    if (status === "Review") {
      return 1;
    }
    if (status === "New") {
      return 2;
    }
    return 3;
  };

  return eligible.sort((a, b) => {
    const ra = rank(String(a.Status ?? "").trim());
    const rb = rank(String(b.Status ?? "").trim());
    if (ra !== rb) {
      return ra - rb;
    }
    return (a.row_number ?? 0) - (b.row_number ?? 0);
  });
}

export async function runQueueRecheck(input: {
  workspace: WorkspaceRecord;
  dryRun: boolean;
  limit?: number;
  statuses?: string[];
  offset?: number;
}): Promise<QueueRecheckResult> {
  if (browserApplyLockHeld()) {
    return { status: "skipped", dryRun: input.dryRun, scanned: 0, changed: 0, summary: {}, rows: [], };
  }
  if (!claimRecheckLock()) {
    return {
      status: "skipped",
      dryRun: input.dryRun,
      scanned: 0,
      changed: 0,
      summary: { recheck_in_progress: 1 },
      rows: [],
    };
  }

  const maxLimit = Number(process.env.QUEUE_RECHECK_MAX_LIMIT ?? "200");
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, maxLimit));
  const statuses = input.statuses ?? ["Manual", "Review", "New"];
  const verifiedAt = new Date().toISOString();
  const summary: Record<string, number> = {};
  const rowResults: QueueRecheckRowResult[] = [];
  const patches: Array<{ rowNumber: number; patch: Record<string, string> }> = [];

  try {
    const allRows = await readJobSheetRows(input.workspace);
    const ordered = prioritizeRows(allRows, statuses);
    const offset = Math.max(0, input.offset ?? 0);
    const slice = ordered.slice(offset, offset + limit);

    const inspectInputs = slice.map((row) => {
      const rawUrl = String(row["Job URL"] ?? "").trim();
      const candidates = recoverCanonicalJobUrls(rawUrl);
      const url = candidates[0] ?? rawUrl;
      return {
        row,
        url,
        role: String(row.Role ?? "").trim(),
      };
    });

    const verdicts = await inspectJobUrls(
      inspectInputs.map((item) => ({ url: item.url, role: item.role })),
    );

    for (let i = 0; i < slice.length; i += 1) {
      const row = slice[i]!;
      const liveness = verdicts[i]!;
      const rawUrl = String(row["Job URL"] ?? "").trim();
      const capability = resolveApplyCapability(liveness.finalUrl || rawUrl);

      if (!rawUrl) {
        rowResults.push({
          row_number: row.row_number!,
          company: row.Company,
          role: row.Role,
          previousStatus: row.Status,
          skipped: "empty_url",
          applied: false,
        });
        summary.skipped_empty_url = (summary.skipped_empty_url ?? 0) + 1;
        continue;
      }

      if (!isSpecificJobUrl(liveness.finalUrl || rawUrl)) {
        const rec = recommendQueueStatus({
          currentStatus: String(row.Status ?? ""),
          notes: String(row.Notes ?? ""),
          rawJobUrl: rawUrl,
          role: String(row.Role ?? ""),
          capability,
          liveness: {
            ...liveness,
            definitelyActive: false,
            reason: liveness.reason || "URL is a search/list hub, not a posting.",
          },
          verifiedAt,
        });
        if (!rec) {
          rowResults.push({
            row_number: row.row_number!,
            previousStatus: row.Status,
            skipped: "preserved_status",
            applied: false,
          });
          continue;
        }
        const patch: Record<string, string> = { Notes: rec.notesPatch ?? String(row.Notes ?? "") };
        if (rec.status !== String(row.Status ?? "").trim()) {
          patch.Status = rec.status;
        }
        if (rec.canonicalUrl && rec.canonicalUrl !== rawUrl) {
          patch["Job URL"] = rec.canonicalUrl;
        }
        rowResults.push({
          row_number: row.row_number!,
          company: row.Company,
          role: row.Role,
          previousStatus: row.Status,
          recommendedStatus: rec.status,
          reason: rec.reason,
          evidence: rec.evidence,
          applied: !input.dryRun && Object.keys(patch).length > 0,
        });
        summary[rec.reason] = (summary[rec.reason] ?? 0) + 1;
        if (!input.dryRun) {
          patches.push({ rowNumber: row.row_number!, patch });
        }
        continue;
      }

      const rec = recommendQueueStatus({
        currentStatus: String(row.Status ?? ""),
        notes: String(row.Notes ?? ""),
        rawJobUrl: rawUrl,
        role: String(row.Role ?? ""),
        capability,
        liveness,
        verifiedAt,
      });

      if (!rec) {
        rowResults.push({
          row_number: row.row_number!,
          previousStatus: row.Status,
          skipped: "preserved_status",
          applied: false,
        });
        summary.preserved = (summary.preserved ?? 0) + 1;
        continue;
      }

      const previous = String(row.Status ?? "").trim();
      const patch: Record<string, string> = { Notes: rec.notesPatch ?? String(row.Notes ?? "") };
      if (rec.status !== previous) {
        patch.Status = rec.status;
      }
      if (rec.canonicalUrl && rec.canonicalUrl !== rawUrl) {
        patch["Job URL"] = rec.canonicalUrl;
      }

      rowResults.push({
        row_number: row.row_number!,
        company: row.Company,
        role: row.Role,
        previousStatus: previous,
        recommendedStatus: rec.status,
        reason: rec.reason,
        evidence: rec.evidence,
        applied: false,
      });

      summary[rec.reason] = (summary[rec.reason] ?? 0) + 1;
      if (!input.dryRun && (rec.status !== previous || patch["Job URL"])) {
        patches.push({ rowNumber: row.row_number!, patch });
        rowResults[rowResults.length - 1]!.applied = true;
      }
    }

    if (!input.dryRun && patches.length > 0) {
      await updateJobSheetRows(input.workspace, patches, 40);
    }

    const auditDir = path.join(process.cwd(), "data", "manual-queue");
    fs.mkdirSync(auditDir, { recursive: true });
    const auditPath = path.join(auditDir, `recheck-${verifiedAt.slice(0, 10)}-${Date.now()}.json`);
    fs.writeFileSync(auditPath, JSON.stringify({
      verifiedAt,
      dryRun: input.dryRun,
      limit,
      offset,
      statuses,
      summary,
      rows: rowResults,
    }, null, 2));

    const changed = rowResults.filter((r) => r.applied || (input.dryRun && r.recommendedStatus && r.recommendedStatus !== r.previousStatus)).length;
    log("QUEUE_RECHECK_DONE", { dryRun: input.dryRun, scanned: slice.length, changed, summary });

    return {
      status: "ok",
      dryRun: input.dryRun,
      scanned: slice.length,
      changed,
      summary,
      rows: rowResults,
      auditPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("QUEUE_RECHECK_FAILED", { message });
    return {
      status: "error",
      dryRun: input.dryRun,
      scanned: 0,
      changed: 0,
      summary: { error: 1 },
      rows: [{ row_number: 0, applied: false, skipped: message }],
    };
  } finally {
    releaseRecheckLock();
  }
}
