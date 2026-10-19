import type { ApplyAttemptRecord } from "../models/types.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { findAttemptInLedgers, findAttemptHintOnSheet } from "./attempt-sources.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";

export type McpSubmissionStage = "pre_submit" | "post_submit_click";

export type ReconcileOutcome = "CONFIRMED" | "FAILED_SAFE" | "UNKNOWN" | "RECONCILIATION_REQUIRED";

const APPLIED_SHEET_STATUSES = new Set(["applied", "submitted", "in review", "interview"]);

export function parseSubmissionStageFromNotes(notes?: string): McpSubmissionStage | null {
  const text = notes ?? "";
  if (/submission_stage=post_submit_click/i.test(text)) {
    return "post_submit_click";
  }
  if (/submission_stage=pre_submit/i.test(text)) {
    return "pre_submit";
  }
  return null;
}

export function reconcileSubmitAttempt(input: {
  attemptId: string;
  workspace: WorkspaceRecord;
  submissionStage?: McpSubmissionStage | null;
  sheetRows?: JobSheetRow[];
}): ReconcileOutcome {
  const stage = input.submissionStage ?? null;
  if (stage === "post_submit_click") {
    return "UNKNOWN";
  }
  if (stage === "pre_submit") {
    return "UNKNOWN";
  }

  const { record } = findAttemptInLedgers(input.attemptId, input.workspace);
  if (record?.confirmationDetected || record?.pipeline?.confirmed) {
    return "CONFIRMED";
  }
  if (record?.submitted || record?.pipeline?.submitted) {
    return "UNKNOWN";
  }
  if (record?.outcome === "applied") {
    return "UNKNOWN";
  }
  if (record?.blocker === "submitted_unconfirmed") {
    return "UNKNOWN";
  }

  const sheetHint = input.sheetRows
    ? findAttemptHintOnSheet(input.sheetRows, input.attemptId)
    : null;
  if (sheetHint && APPLIED_SHEET_STATUSES.has(sheetHint.status.trim().toLowerCase())) {
    return "RECONCILIATION_REQUIRED";
  }

  if (!record) {
    return "UNKNOWN";
  }

  const ledgerStage = parseSubmissionStageFromNotes(record.notes);
  if (ledgerStage) {
    return "UNKNOWN";
  }

  if (record.outcome === "in_progress") {
    return "FAILED_SAFE";
  }

  if (
    record.confirmationDetected === false
    && record.submitted === false
    && (record.pipeline?.submitted === false || record.pipeline?.submitted === undefined)
  ) {
    return "FAILED_SAFE";
  }

  return "RECONCILIATION_REQUIRED";
}

export function ledgerShowsDefiniteSubmission(record: ApplyAttemptRecord | null): boolean {
  if (!record) {
    return false;
  }
  return Boolean(
    record.confirmationDetected
    || record.pipeline?.confirmed
    || record.submitted
    || record.pipeline?.submitted
    || record.outcome === "applied"
    || record.blocker === "submitted_unconfirmed",
  );
}
