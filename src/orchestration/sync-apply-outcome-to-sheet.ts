import type { ApplyInput } from "../application/apply-job.js";
import { log } from "../logging/logger.js";
import type { ApplicationResult } from "../models/types.js";
import { mapApplyResultToSheetPatch } from "./sheet-result.js";
import { readJobSheetRows, updateJobSheetRow, type JobSheetRow } from "./sheets/job-sheet.js";
import { getWorkspace } from "./workspace-store.js";

/** Real apply attempts with a sheet row should always write Status/Notes back (SSOT for /apply and native runs). */
export function shouldSyncApplyOutcomeToSheet(input: ApplyInput): boolean {
  const row = input.row;
  if (row === undefined || row === null || !Number.isFinite(row) || row < 2) {
    return false;
  }
  return input.submit === true;
}

export async function syncApplyOutcomeToJobSheet(
  input: ApplyInput,
  outcome: ApplicationResult,
): Promise<void> {
  if (!shouldSyncApplyOutcomeToSheet(input)) {
    log("SHEET_SYNC_SKIPPED", {
      row: input.row ?? null,
      submit: input.submit === true,
      status: outcome.status,
      reason: input.submit !== true ? "dry_run_or_preview" : "no_row",
    });
    return;
  }
  const workspaceId = (input.workspaceId ?? "internal").trim() || "internal";
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    log("SHEET_SYNC_FAILED", { workspaceId, row: input.row, reason: "workspace_not_found" });
    return;
  }
  const rowNumber = Math.floor(Number(input.row));
  let src: JobSheetRow = stubRow(rowNumber, input);
  try {
    const rows = await readJobSheetRows(workspace);
    const found = rows.find((item) => item.row_number === rowNumber);
    if (found) {
      src = found;
    }
  } catch (error) {
    log("SHEET_SYNC_READ_FAILED", {
      row: rowNumber,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const patch = mapApplyResultToSheetPatch(src, outcome, workspace.timezone);
  try {
    await updateJobSheetRow(workspace, rowNumber, patch);
    log("SHEET_SYNC_OK", { row: rowNumber, status: patch.Status, workspaceId });
  } catch (error) {
    log("SHEET_SYNC_FAILED", {
      row: rowNumber,
      workspaceId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function stubRow(rowNumber: number, input: ApplyInput): JobSheetRow {
  return {
    row_number: rowNumber,
    Company: input.job.company,
    Role: input.job.role,
    "Job URL": input.job.url,
  };
}
