import { claimBrowserApply, releaseBrowserApply } from "../application/browser-apply-lock.js";
import { executeApply } from "../application/execute-apply.js";
import { newAttemptId } from "../application/attempt-ledger.js";
import { setExcludedCompanies } from "../application/exclude-company.js";
import { claimApplyRun, releaseApplyRun } from "../application/run-lock.js";
import { log } from "../logging/logger.js";
import type { ApplyInput } from "../application/apply-job.js";
import { appendNativeRunLog } from "./native-run-log.js";
import { pickWorkspaceApplyBatch, sheetMatchScore } from "./pick-jobs.js";
import { mapApplyResultToSheetPatch } from "./sheet-result.js";
import { readExcludeCompanies, readJobSheetRows, updateJobSheetRow } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { withDb } from "./db.js";
import { insertOrchestrationRun, markWorkspaceRunKey } from "./workspace-store.js";

export type ApplyDailyOptions = {
  workspace: WorkspaceRecord;
  runSource: "native_schedule" | "native_manual";
  submit: boolean;
  dryRun: boolean;
};

export type ApplyDailyResult = {
  status: "ok" | "skipped" | "locked" | "error";
  picked: number;
  attempted: number;
  notes: string;
};

export async function runWorkspaceApplyDaily(options: ApplyDailyOptions): Promise<ApplyDailyResult> {
  const { workspace, runSource, submit, dryRun } = options;
  const runLock = claimApplyRun(workspace.id);
  if (!runLock.ok) {
    return { status: "locked", picked: 0, attempted: 0, notes: runLock.reason };
  }
  const startedAt = new Date().toISOString();
  let picked = 0;
  let attempted = 0;
  try {
    const rows = await readJobSheetRows(workspace);
    const excluded = await readExcludeCompanies(workspace);
    setExcludedCompanies(excluded, `workspace:${workspace.id}:sheet`);
    const batch = pickWorkspaceApplyBatch(rows, excluded);
    picked = batch.selected.length;
    if (picked === 0) {
      const result: ApplyDailyResult = {
        status: "skipped",
        picked: 0,
        attempted: 0,
        notes: `No eligible rows (eligible=${batch.eligible}).`,
      };
      await finishRun(workspace, runSource, startedAt, result);
      return result;
    }
    if (dryRun) {
      const result: ApplyDailyResult = {
        status: "ok",
        picked,
        attempted: 0,
        notes: `dry_run picked=${picked} tech=${batch.pickedTech} marketing=${batch.pickedMarketing}`,
      };
      await finishRun(workspace, runSource, startedAt, result);
      return result;
    }
    for (const row of batch.selected) {
      const browserClaim = claimBrowserApply();
      if (!browserClaim.ok) {
        log("APPLY_DAILY_BROWSER_BUSY", { workspaceId: workspace.id });
        break;
      }
      try {
        const input: ApplyInput = {
          row: row.row_number,
          submit,
          job: {
            role: String(row.Role ?? ""),
            company: String(row.Company ?? ""),
            url: String(row["Job URL"] ?? ""),
            matchScore: sheetMatchScore(row),
            category: String(row.Category ?? ""),
            estimatedSalary: String(row["Est. Salary Range"] ?? ""),
          },
          attemptId: newAttemptId(),
          startedAt: new Date().toISOString(),
        };
        const outcome = await executeApply(input);
        attempted += 1;
        if (!dryRun && row.row_number) {
          const patch = mapApplyResultToSheetPatch(row, outcome, workspace.timezone);
          await updateJobSheetRow(workspace, row.row_number, patch);
        }
      } finally {
        releaseBrowserApply();
      }
    }
    const result: ApplyDailyResult = {
      status: "ok",
      picked,
      attempted,
      notes: `attempted=${attempted} picked=${picked}`,
    };
    await finishRun(workspace, runSource, startedAt, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("APPLY_DAILY_FAILED", { workspaceId: workspace.id, message });
    const result: ApplyDailyResult = { status: "error", picked, attempted, notes: message };
    await finishRun(workspace, runSource, startedAt, result);
    return result;
  } finally {
    releaseApplyRun(workspace.id);
  }
}

async function finishRun(
  workspace: WorkspaceRecord,
  runSource: "native_schedule" | "native_manual",
  startedAt: string,
  result: ApplyDailyResult,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const runKey = startedAt.slice(0, 16);
  await markWorkspaceRunKey(workspace.id, "apply", runKey);
  appendNativeRunLog({
    workspaceId: workspace.id,
    kind: "apply",
    runSource,
    startedAt,
    finishedAt,
    status: result.status,
    summary: { picked: result.picked, attempted: result.attempted, notes: result.notes },
  });
  try {
    await withDb(async (client) => {
      await insertOrchestrationRun(client, {
        workspaceId: workspace.id,
        kind: "apply",
        runSource,
        startedAt,
        finishedAt,
        status: result.status,
        summary: { picked: result.picked, attempted: result.attempted, notes: result.notes },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ORCHESTRATION_RUN_DB_LOG_FAILED", { workspaceId: workspace.id, message });
  }
}
