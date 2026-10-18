import { resolveApplyCapability } from "../application/ats-capability.js";
import { shouldSkipApplyForScopeDedup } from "../application/submission-dedup.js";
import { isEligibleApplySheetRow, sheetMatchScore } from "../orchestration/pick-jobs.js";
import { readExcludeCompanies, readJobSheetRows, type JobSheetRow } from "../orchestration/sheets/job-sheet.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { findJobSheetRow } from "./job-sheet-lookup.js";
import { readAttemptsFromLedgerPaths, collectApplyAttemptLedgerPaths } from "./attempt-sources.js";
import { redactRecord } from "./redact.js";

export type QueueRowExport = {
  rowNumber: number;
  company: string;
  role: string;
  category: string;
  status: string;
  jobUrl: string;
  matchScore: number;
  eligible: boolean;
  capability: string;
  blockers: string[];
  priorAttemptCount: number;
  lastAttemptOutcome?: string;
};

function blockersForRow(row: JobSheetRow, excludedCompanies: string[]): string[] {
  const blockers: string[] = [];
  const url = String(row["Job URL"] ?? "").trim();
  if (!isEligibleApplySheetRow(row)) {
    blockers.push("not_eligible_for_auto_apply");
  }
  const company = String(row.Company ?? "");
  if (excludedCompanies.some((item) => item.toLowerCase() === company.toLowerCase())) {
    blockers.push("excluded_company");
  }
  const dedup = shouldSkipApplyForScopeDedup(url);
  if (dedup.skip) {
    blockers.push(`dedup:${dedup.reason}`);
  }
  return blockers;
}

function attemptsForUrl(
  url: string,
  attempts: ReturnType<typeof readAttemptsFromLedgerPaths>["attempts"],
): { count: number; lastOutcome?: string } {
  const normalized = url.trim().toLowerCase();
  const matches = attempts.filter(
    (row) =>
      row.originalJobUrl.trim().toLowerCase() === normalized
      || (row.canonicalJobUrl ?? "").trim().toLowerCase() === normalized,
  );
  const last = matches[matches.length - 1];
  return {
    count: matches.length,
    lastOutcome: last?.outcome,
  };
}

export function queueRowFromSheetRow(
  row: JobSheetRow,
  excluded: string[],
  attempts: ReturnType<typeof readAttemptsFromLedgerPaths>["attempts"],
): QueueRowExport {
  const status = String(row.Status ?? "").trim();
  const url = String(row["Job URL"] ?? "").trim();
  const attemptInfo = attemptsForUrl(url, attempts);
  return {
    rowNumber: Number(row.row_number ?? 0),
    company: String(row.Company ?? ""),
    role: String(row.Role ?? ""),
    category: String(row.Category ?? ""),
    status,
    jobUrl: url,
    matchScore: sheetMatchScore(row),
    eligible: isEligibleApplySheetRow(row),
    capability: resolveApplyCapability(url),
    blockers: blockersForRow(row, excluded),
    priorAttemptCount: attemptInfo.count,
    lastAttemptOutcome: attemptInfo.lastOutcome,
  };
}

export async function buildQueueExport(
  workspace: WorkspaceRecord,
  options: { limit: number; statusFilter?: string },
): Promise<{ workspaceId: string; rows: QueueRowExport[]; truncated: boolean }> {
  const limit = Math.min(Math.max(1, options.limit), 100);
  const sheetRows = await readJobSheetRows(workspace);
  const excluded = await readExcludeCompanies(workspace);
  const statusNeedle = options.statusFilter?.trim().toLowerCase();
  const { attempts } = readAttemptsFromLedgerPaths(collectApplyAttemptLedgerPaths(workspace));

  const exports: QueueRowExport[] = [];
  for (const row of sheetRows) {
    const status = String(row.Status ?? "").trim();
    if (statusNeedle && status.toLowerCase() !== statusNeedle) {
      continue;
    }
    exports.push(queueRowFromSheetRow(row, excluded, attempts));
    if (exports.length >= limit) {
      break;
    }
  }

  return {
    workspaceId: workspace.id,
    rows: exports.map((row) => redactRecord(row as unknown as Record<string, unknown>) as QueueRowExport),
    truncated: exports.length >= limit,
  };
}

export async function buildJobDetailExport(
  workspace: WorkspaceRecord,
  query: { rowNumber?: number; jobUrl?: string },
): Promise<Record<string, unknown> | null> {
  if (!query.rowNumber && !query.jobUrl?.trim()) {
    return null;
  }
  const sheetRows = await readJobSheetRows(workspace);
  const matchRow = findJobSheetRow(sheetRows, query);
  if (!matchRow) {
    return null;
  }
  const excluded = await readExcludeCompanies(workspace);
  const { attempts } = readAttemptsFromLedgerPaths(collectApplyAttemptLedgerPaths(workspace));
  const match = queueRowFromSheetRow(matchRow, excluded, attempts);
  const url = match.jobUrl;
  const history = attempts.filter(
    (row) =>
      row.originalJobUrl.trim().toLowerCase() === url.trim().toLowerCase()
      || (row.canonicalJobUrl ?? "").trim().toLowerCase() === url.trim().toLowerCase(),
  );
  return redactRecord({
    job: match,
    applicationHistory: history.slice(-20).map((attempt) => ({
      attemptId: attempt.attemptId,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      outcome: attempt.outcome,
      blocker: attempt.blocker,
      submitted: attempt.submitted,
      confirmationDetected: attempt.confirmationDetected,
      pipeline: attempt.pipeline,
      notes: attempt.notes?.slice(0, 500),
    })),
  });
}
