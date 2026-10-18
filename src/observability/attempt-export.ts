import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import {
  collectApplyAttemptLedgerPaths,
  findAttemptHintOnSheet,
  findAttemptInLedgers,
  readAttemptsFromLedgerPaths,
} from "./attempt-sources.js";
import { readJobSheetRows } from "../orchestration/sheets/job-sheet.js";
import { cvPathForObservability, redactRecord } from "./redact.js";

function exportFromRecord(attempt: import("../models/types.js").ApplyAttemptRecord): Record<string, unknown> {
  return redactRecord({
    attemptId: attempt.attemptId,
    workspaceId: attempt.workspaceId,
    runId: attempt.runId,
    runSource: attempt.runSource,
    company: attempt.company,
    role: attempt.role,
    originalJobUrl: attempt.originalJobUrl,
    canonicalJobUrl: attempt.canonicalJobUrl,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    outcome: attempt.outcome,
    blocker: attempt.blocker,
    submitted: attempt.submitted,
    confirmationDetected: attempt.confirmationDetected,
    submissionScope: attempt.submissionScope,
    pipeline: attempt.pipeline,
    cvRef: cvPathForObservability(attempt.cvPath),
    notes: attempt.notes?.slice(0, 800),
  });
}

export type AttemptResolution =
  | { status: "found"; attempt: Record<string, unknown>; ledgerSources: string[] }
  | {
      status: "sheet_only";
      attemptId: string;
      sheetHint: Record<string, unknown>;
      ledgerSources: string[];
      message: string;
    }
  | { status: "not_found"; attemptId: string; ledgerSources: string[]; message: string };

export async function resolveAttemptExport(
  attemptId: string,
  workspace?: WorkspaceRecord | null,
): Promise<AttemptResolution> {
  const { record, sources } = findAttemptInLedgers(attemptId, workspace);
  if (record) {
    return {
      status: "found",
      attempt: exportFromRecord(record),
      ledgerSources: sources,
    };
  }

  if (workspace) {
    try {
      const rows = await readJobSheetRows(workspace);
      const hint = findAttemptHintOnSheet(rows, attemptId);
      if (hint) {
        return {
          status: "sheet_only",
          attemptId,
          sheetHint: redactRecord(hint as unknown as Record<string, unknown>),
          ledgerSources: sources,
          message:
            "Attempt id appears on the job sheet but was not found in apply-attempts ledgers (historical or rotated ledger).",
        };
      }
    } catch {
      // sheet read failure handled below
    }
  }

  return {
    status: "not_found",
    attemptId,
    ledgerSources: collectApplyAttemptLedgerPaths(workspace),
    message: "No attempt record in configured ledgers; sheet scan did not reference this id.",
  };
}

export function getAttemptExport(
  attemptId: string,
  workspace?: WorkspaceRecord | null,
): Record<string, unknown> | null {
  const { record } = findAttemptInLedgers(attemptId, workspace);
  if (!record) {
    return null;
  }
  return exportFromRecord(record);
}

export function listRecentAttempts(limit: number, workspace?: WorkspaceRecord | null): Record<string, unknown>[] {
  const bounded = Math.min(Math.max(1, limit), 100);
  const { attempts } = readAttemptsFromLedgerPaths(collectApplyAttemptLedgerPaths(workspace));
  const rows = attempts.slice(-bounded).reverse();
  return rows.map((attempt) =>
    redactRecord({
      attemptId: attempt.attemptId,
      company: attempt.company,
      role: attempt.role,
      outcome: attempt.outcome,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      jobUrl: attempt.canonicalJobUrl ?? attempt.originalJobUrl,
    }),
  );
}
