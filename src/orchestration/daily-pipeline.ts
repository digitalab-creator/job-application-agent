import { applyBudgetAllowsWork } from "../application/apply-policy.js";
import { budgetSnapshot } from "../budget/monthly-budget.js";
import { quotaSnapshot } from "../application/daily-quota.js";
import { log } from "../logging/logger.js";
import { runWorkspaceApplyDaily } from "./apply-daily.js";
import { runWorkspaceDiscoverDaily } from "./discover-daily.js";
import { computeQueueDepthSnapshot } from "./queue-depth.js";
import { readExcludeCompanies, readJobSheetRows } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { maybeTriggerPipelineRepair } from "./pipeline-repair-trigger.js";
import { dailyConfirmedApplicationsTarget } from "./daily-target.js";
import { scheduleSlotKey } from "../time/jerusalem-day.js";
import { markWorkspaceRunKey } from "./workspace-store.js";
import { shouldStopAfterEmptyApply } from "./daily-pipeline-policy.js";

export type DailyPipelineResult = {
  status: "ok" | "skipped" | "error";
  confirmedStart: number;
  confirmedEnd: number;
  targetConfirmed: number;
  discoverRuns: number;
  applyRuns: number;
  notes: string;
};

function maxPipelineCycles(): number {
  const parsed = Number(process.env.DAILY_PIPELINE_MAX_CYCLES ?? "48");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 48;
  }
  return Math.floor(parsed);
}

/**
 * Self-replenishing day loop: discover when actionable supply is low, then apply until
 * daily paced budget is spent or no eligible jobs remain.
 */
export async function runWorkspaceDailyPipeline(input: {
  workspace: WorkspaceRecord;
  runSource: "native_schedule" | "native_manual";
  submit: boolean;
  dryRun: boolean;
}): Promise<DailyPipelineResult> {
  const target = dailyConfirmedApplicationsTarget();
  const quota0 = quotaSnapshot();
  let confirmed = quota0.confirmed;
  let discoverRuns = 0;
  let applyRuns = 0;
  let lastDiscoverAdded: number | null = null;
  const notes: string[] = [];

  for (let cycle = 0; cycle < maxPipelineCycles(); cycle += 1) {
    if (!applyBudgetAllowsWork()) {
      const budget = budgetSnapshot();
      notes.push(`daily_budget_spent daily=${budget.dailySpentIls}/${budget.dailyBudgetIls} ils`);
      break;
    }
    const rows = await readJobSheetRows(input.workspace);
    const excluded = await readExcludeCompanies(input.workspace);
    const depth = computeQueueDepthSnapshot(rows, excluded);
    const lowSupply = depth.automatableEmployment < 1;
    if (lowSupply) {
      const discover = await runWorkspaceDiscoverDaily({
        workspace: input.workspace,
        runSource: input.runSource,
        dryRun: input.dryRun,
        scheduleSlot: input.runSource === "native_schedule" ? "pipeline_inner" : "default",
      });
      discoverRuns += 1;
      lastDiscoverAdded = discover.added;
      notes.push(`discover_cycle=${cycle} status=${discover.status} added=${discover.added}`);
      if (discover.status === "error") {
        return {
          status: "error",
          confirmedStart: quota0.confirmed,
          confirmedEnd: confirmed,
          targetConfirmed: target,
          discoverRuns,
          applyRuns,
          notes: notes.join("\n"),
        };
      }
    }
    const apply = await runWorkspaceApplyDaily({
      workspace: input.workspace,
      runSource: input.runSource,
      submit: input.submit,
      dryRun: input.dryRun,
      scheduleSlot: input.runSource === "native_schedule" ? "pipeline_inner" : "default",
    });
    applyRuns += 1;
    notes.push(`apply_cycle=${cycle} status=${apply.status} picked=${apply.picked} attempted=${apply.attempted} confirmed=${apply.confirmed ?? 0}`);
    confirmed = quotaSnapshot().confirmed;
    if (apply.status === "locked" || apply.status === "error") {
      log("DAILY_PIPELINE_STOP", { cycle, applyStatus: apply.status });
      break;
    }
    if (apply.picked === 0 && apply.attempted === 0) {
      const depthAfter = computeQueueDepthSnapshot(
        await readJobSheetRows(input.workspace),
        excluded,
      );
      const stop = shouldStopAfterEmptyApply({
        dailyBudgetOpen: applyBudgetAllowsWork(),
        lastDiscoverAdded,
        automatableEmployment: depthAfter.automatableEmployment,
      });
      if (stop.stop) {
        notes.push(`pipeline_stop=${stop.reason}`);
        break;
      }
      notes.push("pipeline_retry_discover_budget_remain");
      continue;
    }
    if (!applyBudgetAllowsWork()) {
      notes.push("daily_budget_spent_after_apply");
      break;
    }
    if (apply.picked > 0) {
      lastDiscoverAdded = null;
    }
  }

  if (input.runSource === "native_schedule" && !input.dryRun) {
    const applySlot = scheduleSlotKey("apply", input.workspace.timezone);
    await markWorkspaceRunKey(input.workspace.id, "apply", applySlot);
    if (discoverRuns > 0) {
      await markWorkspaceRunKey(
        input.workspace.id,
        "discover",
        scheduleSlotKey("discover", input.workspace.timezone),
      );
    }
  }

  const result: DailyPipelineResult = {
    status: "ok",
    confirmedStart: quota0.confirmed,
    confirmedEnd: confirmed,
    targetConfirmed: target,
    discoverRuns,
    applyRuns,
    notes: notes.join("\n"),
  };
  maybeTriggerPipelineRepair({
    endOfDay: true,
    confirmedEnd: result.confirmedEnd,
    targetConfirmed: result.targetConfirmed,
  });
  return result;
}
