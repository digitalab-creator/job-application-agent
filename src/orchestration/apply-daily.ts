import { claimBrowserApply, releaseBrowserApply } from "../application/browser-apply-lock.js";
import { executeApply } from "../application/execute-apply.js";
import { newAttemptId } from "../application/attempt-ledger.js";
import { setExcludedCompanies } from "../application/exclude-company.js";
import { claimApplyRun, releaseApplyRun } from "../application/run-lock.js";
import { log } from "../logging/logger.js";
import type { ApplyInput } from "../application/apply-job.js";
import { appendNativeRunLog } from "./native-run-log.js";
import { processFreelanceBatch } from "../freelance/process-freelance-batch.js";
import { claimScheduledSlot, type ScheduleSlotMode } from "./schedule-claim.js";
import { finishScheduledSlotIfNeeded } from "./schedule-slot-finish.js";
import { withSearchPolicy } from "../config/search-policy-runtime.js";
import { pickWorkspaceApplyBatch, sheetMatchScore } from "./pick-jobs.js";
import { loadSearchPolicyFromSheet } from "./sheets/search-config.js";
import { opportunityKindFromRow } from "../freelance/opportunity-kind.js";
import { readExcludeCompanies, readJobSheetRows } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { withDb } from "./db.js";
import { insertOrchestrationRun } from "./workspace-store.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "./workspace-runtime.js";
import { randomUUID } from "node:crypto";
import { applyBudgetAllowsWork } from "../application/apply-policy.js";
import { budgetSnapshot } from "../budget/monthly-budget.js";

export type ApplyDailyOptions = {
  workspace: WorkspaceRecord;
  runSource: "native_schedule" | "native_manual";
  submit: boolean;
  dryRun: boolean;
  /** When `pipeline_inner`, do not claim/mark the once-per-day apply slot (daily pipeline owns that). */
  scheduleSlot?: ScheduleSlotMode;
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
  const { workspace, runSource, submit, dryRun, scheduleSlot = "default" } = options;
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
      if (scheduleSlot !== "pipeline_inner") {
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
      }
      const excluded = await readExcludeCompanies(workspace);
      setExcludedCompanies(excluded, `workspace:${workspace.id}:sheet`);
      const searchPolicy = await loadSearchPolicyFromSheet(workspace);
      const initialRows = await readJobSheetRows(workspace);
      const freelance = await processFreelanceBatch(workspace, initialRows, dryRun);

      let batchesRun = 0;
      let lastEligible = 0;
      let lastTech = 0;
      let lastMkt = 0;
      let stoppedForBudget = false;

      while (!dryRun && applyBudgetAllowsWork()) {
        const rows = await readJobSheetRows(workspace);
        const batch = await withSearchPolicy(searchPolicy, async () => pickWorkspaceApplyBatch(rows, excluded));
        lastEligible = batch.eligible;
        lastTech = batch.pickedTech;
        lastMkt = batch.pickedMarketing;
        if (batch.selected.length === 0) {
          break;
        }
        picked += batch.selected.length;
        batchesRun += 1;
        for (const row of batch.selected) {
          if (!applyBudgetAllowsWork()) {
            stoppedForBudget = true;
            break;
          }
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
        if (stoppedForBudget) {
          break;
        }
      }

      if (!dryRun && !applyBudgetAllowsWork()) {
        stoppedForBudget = true;
      }
      const budget = budgetSnapshot();

      if (dryRun) {
        const batch = await withSearchPolicy(searchPolicy, async () =>
          pickWorkspaceApplyBatch(initialRows, excluded),
        );
        picked = batch.selected.length;
        const result: ApplyDailyResult = {
          status: picked === 0 ? "skipped" : "ok",
          picked,
          attempted: 0,
          notes: `dry_run picked=${picked} tech=${batch.pickedTech} marketing=${batch.pickedMarketing}. ${freelance.notes}`,
          freelancePacksReady: freelance.packsReady,
        };
        await finishRun(workspace, runSource, startedAt, result, scheduleSlot);
        return result;
      }

      if (picked === 0) {
        const result: ApplyDailyResult = {
          status: "skipped",
          picked: 0,
          attempted: 0,
          notes: `No eligible rows (eligible=${lastEligible}). ${freelance.notes}`,
          freelancePacksReady: freelance.packsReady,
        };
        await finishRun(workspace, runSource, startedAt, result, scheduleSlot);
        return result;
      }

      const result: ApplyDailyResult = {
        status: "ok",
        picked,
        attempted,
        confirmed,
        freelancePacksReady: freelance.packsReady,
        notes: [
          `attempted=${attempted}`,
          `confirmed=${confirmed}`,
          `picked=${picked}`,
          `batches=${batchesRun}`,
          `eligible_last=${lastEligible}`,
          `tech=${lastTech}`,
          `mkt=${lastMkt}`,
          `daily_budget_ils=${budget.dailySpentIls}/${budget.dailyBudgetIls}`,
          `daily_remaining_ils=${budget.dailyRemainingIls}`,
          `monthly_remaining_ils=${budget.remainingIls}`,
          `days_left=${budget.daysRemaining}`,
          stoppedForBudget ? "stop_reason=daily_budget_spent" : "",
          freelance.notes,
        ].filter(Boolean).join(" "),
      };
      await finishRun(workspace, runSource, startedAt, result, scheduleSlot);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("APPLY_DAILY_FAILED", { workspaceId: workspace.id, message });
      const result: ApplyDailyResult = { status: "error", picked, attempted, notes: message };
      await finishRun(workspace, runSource, startedAt, result, scheduleSlot);
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
  scheduleSlot: ScheduleSlotMode = "default",
): Promise<void> {
  const finishedAt = new Date().toISOString();
  await finishScheduledSlotIfNeeded({
    workspace,
    kind: "apply",
    runSource,
    scheduleSlot,
    startedAt,
    status: result.status,
    errorSummary: result.notes,
  });
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
