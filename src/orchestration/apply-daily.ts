import { claimBrowserApply, releaseBrowserApply } from "../application/browser-apply-lock.js";
import { executeApply } from "../application/execute-apply.js";
import { newAttemptId } from "../application/attempt-ledger.js";
import { setExcludedCompanies } from "../application/exclude-company.js";
import { claimApplyRun, releaseApplyRun } from "../application/run-lock.js";
import { log } from "../logging/logger.js";
import type { ApplyInput } from "../application/apply-job.js";
import { appendNativeRunLog } from "./native-run-log.js";
import { processFreelanceBatch } from "../freelance/process-freelance-batch.js";
import { scheduleSlotKey } from "../time/jerusalem-day.js";
import { claimScheduledSlot } from "./schedule-claim.js";
import { withSearchPolicy } from "../config/search-policy-runtime.js";
import { pickWorkspaceApplyBatch, sheetMatchScore } from "./pick-jobs.js";
import { loadSearchPolicyFromSheet } from "./sheets/search-config.js";
import { opportunityKindFromRow } from "../freelance/opportunity-kind.js";
import { readExcludeCompanies, readJobSheetRows } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { withDb } from "./db.js";
import { insertOrchestrationRun, markWorkspaceRunKey } from "./workspace-store.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "./workspace-runtime.js";
import { randomUUID } from "node:crypto";

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
  confirmed?: number;
  freelancePacksReady?: number;
  notes: string;
};

export async function runWorkspaceApplyDaily(options: ApplyDailyOptions): Promise<ApplyDailyResult> {
  const { workspace, runSource, submit, dryRun } = options;
  const batchId = randomUUID();
  return withWorkspaceRuntime(runtimeFromWorkspace(workspace, runSource, { batchId, runId: batchId }), async () => {
    const runLock = claimApplyRun(workspace.id);
    if (!runLock.ok) {
      return { status: "locked", picked: 0, attempted: 0, notes: runLock.reason };
    }
    const startedAt = new Date().toISOString();
    let picked = 0;
      let attempted = 0;
      let confirmed = 0;
    try {
      const claim = await claimScheduledSlot(workspace, "apply", runSource);
      if (!claim.ok) {
        const result: ApplyDailyResult = {
          status: "skipped",
          picked: 0,
          attempted: 0,
          notes: claim.reason,
        };
        return result;
      }
      const rows = await readJobSheetRows(workspace);
      const excluded = await readExcludeCompanies(workspace);
      setExcludedCompanies(excluded, `workspace:${workspace.id}:sheet`);
      const searchPolicy = await loadSearchPolicyFromSheet(workspace);
      const freelance = await processFreelanceBatch(workspace, rows, dryRun);
      const batch = await withSearchPolicy(searchPolicy, async () => pickWorkspaceApplyBatch(rows, excluded));
      picked = batch.selected.length;
      if (picked === 0) {
        const result: ApplyDailyResult = {
          status: "skipped",
          picked: 0,
          attempted: 0,
          notes: `No eligible rows (eligible=${batch.eligible}). ${freelance.notes}`,
          freelancePacksReady: freelance.packsReady,
        };
        await finishRun(workspace, runSource, startedAt, result);
        return result;
      }
      if (dryRun) {
        const result: ApplyDailyResult = {
          status: "ok",
          picked,
          attempted: 0,
          notes: `dry_run picked=${picked} tech=${batch.pickedTech} marketing=${batch.pickedMarketing}. ${freelance.notes}`,
          freelancePacksReady: freelance.packsReady,
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
            workspaceId: workspace.id,
            runSource,
            runId: batchId,
            batchId,
            triggeredAt: startedAt,
            job: {
              role: String(row.Role ?? ""),
              company: String(row.Company ?? ""),
              url: String(row["Job URL"] ?? ""),
              matchScore: sheetMatchScore(row),
              category: String(row.Category ?? ""),
              estimatedSalary: String(row["Est. Salary Range"] ?? ""),
              opportunityKind: opportunityKindFromRow(row),
            },
            attemptId: newAttemptId(),
            startedAt: new Date().toISOString(),
          };
          const outcome = await executeApply(input);
          attempted += 1;
          if (outcome.confirmationDetected || outcome.status === "applied") {
            confirmed += 1;
          }
        } finally {
          releaseBrowserApply();
        }
      }
      const result: ApplyDailyResult = {
        status: "ok",
        picked,
        attempted,
        confirmed,
        freelancePacksReady: freelance.packsReady,
        notes: `attempted=${attempted} confirmed=${confirmed} picked=${picked}. ${freelance.notes}`,
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
  });
}

async function finishRun(
  workspace: WorkspaceRecord,
  runSource: "native_schedule" | "native_manual",
  startedAt: string,
  result: ApplyDailyResult,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const runKey = runSource === "native_schedule"
    ? scheduleSlotKey("apply", workspace.timezone, new Date(startedAt))
    : startedAt.slice(0, 16);
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
