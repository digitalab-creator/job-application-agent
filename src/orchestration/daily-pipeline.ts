import { quotaSnapshot } from "../application/daily-quota.js";
import { DAILY_APPLY_BATCH_LIMIT } from "../discovery/queue-mix.js";
import { log } from "../logging/logger.js";
import { runWorkspaceApplyDaily } from "./apply-daily.js";
import { runWorkspaceDiscoverDaily } from "./discover-daily.js";
import { computeQueueDepthSnapshot } from "./queue-depth.js";
import { readExcludeCompanies, readJobSheetRows } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { maybeTriggerPipelineRepair } from "./pipeline-repair-trigger.js";

export type DailyPipelineResult = {
  status: "ok" | "skipped" | "error";
  confirmedStart: number;
  confirmedEnd: number;
  targetConfirmed: number;
  discoverRuns: number;
  applyRuns: number;
  notes: string;
};

function dailyConfirmedTarget(): number {
  const parsed = Number(process.env.DAILY_CONFIRMED_APPLICATIONS_TARGET ?? "10");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }
  return Math.floor(parsed);
}

function maxPipelineCycles(): number {
  const parsed = Number(process.env.DAILY_PIPELINE_MAX_CYCLES ?? "6");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 6;
  }
  return Math.floor(parsed);
}

/**
 * Self-replenishing day loop: discover when actionable supply is low, then apply until
 * confirmed target or hard limits. Discovery and Apply entry points stay separate.
 */
export async function runWorkspaceDailyPipeline(input: {
  workspace: WorkspaceRecord;
  runSource: "native_schedule" | "native_manual";
  submit: boolean;
  dryRun: boolean;
}): Promise<DailyPipelineResult> {
  const target = dailyConfirmedTarget();
  const quota0 = quotaSnapshot();
  let confirmed = quota0.confirmed;
  let discoverRuns = 0;
  let applyRuns = 0;
  const notes: string[] = [];

  for (let cycle = 0; cycle < maxPipelineCycles(); cycle += 1) {
    if (confirmed >= target) {
      notes.push(`target_met confirmed=${confirmed}`);
      break;
    }
    const rows = await readJobSheetRows(input.workspace);
    const excluded = await readExcludeCompanies(input.workspace);
    const depth = computeQueueDepthSnapshot(rows, excluded);
    const lowSupply = depth.automatableEmployment < DAILY_APPLY_BATCH_LIMIT;
    if (lowSupply) {
      const discover = await runWorkspaceDiscoverDaily({
        workspace: input.workspace,
        runSource: input.runSource,
        dryRun: input.dryRun,
      });
      discoverRuns += 1;
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
    });
    applyRuns += 1;
    notes.push(`apply_cycle=${cycle} status=${apply.status} picked=${apply.picked} attempted=${apply.attempted} confirmed=${apply.confirmed ?? 0}`);
    confirmed = quotaSnapshot().confirmed;
    if (apply.status === "locked" || apply.status === "error") {
      log("DAILY_PIPELINE_STOP", { cycle, applyStatus: apply.status });
      break;
    }
    if (apply.status === "skipped" && apply.picked === 0 && !lowSupply) {
      notes.push("no_eligible_rows_and_supply_not_low");
      break;
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
