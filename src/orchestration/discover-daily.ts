import { recordPlatformAllocationIfNeeded } from "../budget/monthly-budget.js";
import { computeQueueDepthSnapshot } from "./queue-depth.js";
import { withSearchPolicy } from "../config/search-policy-runtime.js";
import { runDiscovery } from "../discovery/run-discovery.js";
import { loadSearchPolicyFromSheet } from "./sheets/search-config.js";
import { log } from "../logging/logger.js";
import { appendNativeRunLog } from "./native-run-log.js";
import {
  filterRowsForSheetAppend,
  postingKeysFromSheetRows,
} from "./sheets/sheet-posting-keys.js";
import { appendDiscoveredJobs, readExcludeCompanies, readJobSheetRows } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { withDb } from "./db.js";
import { insertOrchestrationRun } from "./workspace-store.js";
import { claimScheduledSlot } from "./schedule-claim.js";
import { finishScheduledSlotIfNeeded } from "./schedule-slot-finish.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "./workspace-runtime.js";
import type { ScheduleSlotMode } from "./schedule-claim.js";

export type DiscoverDailyOptions = {
  workspace: WorkspaceRecord;
  runSource: "native_schedule" | "native_manual";
  dryRun: boolean;
  scheduleSlot?: ScheduleSlotMode;
};

export type DiscoverDailyResult = {
  status: "ok" | "skipped" | "error";
  added: number;
  notes: string;
};

export async function runWorkspaceDiscoverDaily(options: DiscoverDailyOptions): Promise<DiscoverDailyResult> {
  const { workspace, runSource, dryRun, scheduleSlot = "default" } = options;
  return withWorkspaceRuntime(runtimeFromWorkspace(workspace, runSource), async () => {
  const startedAt = new Date().toISOString();
  let added = 0;
  try {
    if (scheduleSlot !== "pipeline_inner") {
      const claim = await claimScheduledSlot(workspace, "discover", runSource);
      if (!claim.ok) {
        const result: DiscoverDailyResult = {
          status: "skipped",
          added: 0,
          notes: claim.reason,
        };
        return result;
      }
    }
    recordPlatformAllocationIfNeeded();
    const rows = await readJobSheetRows(workspace);
    const excluded = await readExcludeCompanies(workspace);
    const existingPostingKeys = postingKeysFromSheetRows(rows);
    const depth = computeQueueDepthSnapshot(rows, excluded);
    const newQueueStats = {
      ...depth.mix,
      statusNew: depth.eligibleEmployment,
    };
    const searchPolicy = await loadSearchPolicyFromSheet(workspace);
    const discovery = await withSearchPolicy(searchPolicy, async () => runDiscovery({
      existingPostingKeys,
      newQueueStats,
      boardUrls:
        workspace.discoveryBoardUrls.length > 0 ? workspace.discoveryBoardUrls : undefined,
      sheetRows: rows,
      actionableAutomatable: depth.automatableEmployment,
    }));
    if (discovery.status !== "ok" || discovery.jobs.length === 0) {
      const result: DiscoverDailyResult = {
        status: discovery.status === "ok" ? "skipped" : discovery.status === "budget_reached" ? "skipped" : "skipped",
        added: 0,
        notes: discovery.notes,
      };
      await finishRun(workspace, runSource, startedAt, result, scheduleSlot);
      return result;
    }
    const sheetRowsRaw = discovery.jobs.map((job) => {
      const header = discovery.mixReport ? `AUTO_DISCOVER\n${discovery.mixReport}` : "AUTO_DISCOVER";
      return {
        "Unique Key": job.uniqueKey,
        "Found Date": job.foundDate,
        Role: job.role,
        Company: job.company,
        Category: job.category,
        "Match Score": job.matchScore,
        "Why It Fits": job.whyItFits,
        Source: job.source,
        Location: job.location || "",
        "Job URL": job.url,
        Status: job.sheetStatus ?? "New",
        Notes: `${header}\n${discovery.notes || ""}`.trim(),
      };
    });
    const sheetRows = filterRowsForSheetAppend(sheetRowsRaw, existingPostingKeys);
    if (!dryRun) {
      added = await appendDiscoveredJobs(workspace, sheetRows);
    } else {
      added = sheetRows.length;
    }
    const result: DiscoverDailyResult = {
      status: "ok",
      added,
      notes: discovery.notes,
    };
    await finishRun(workspace, runSource, startedAt, result, scheduleSlot);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("DISCOVER_DAILY_FAILED", { workspaceId: workspace.id, message });
    const result: DiscoverDailyResult = { status: "error", added, notes: message };
    await finishRun(workspace, runSource, startedAt, result, scheduleSlot);
    return result;
  }
  });
}

async function finishRun(
  workspace: WorkspaceRecord,
  runSource: "native_schedule" | "native_manual",
  startedAt: string,
  result: DiscoverDailyResult,
  scheduleSlot: ScheduleSlotMode = "default",
): Promise<void> {
  const finishedAt = new Date().toISOString();
  await finishScheduledSlotIfNeeded({
    workspace,
    kind: "discover",
    runSource,
    scheduleSlot,
    startedAt,
    status: result.status,
    errorSummary: result.notes,
  });
  appendNativeRunLog({
    workspaceId: workspace.id,
    kind: "discover",
    runSource,
    startedAt,
    finishedAt,
    status: result.status,
    summary: { added: result.added, notes: result.notes },
  });
  try {
    await withDb(async (client) => {
      await insertOrchestrationRun(client, {
        workspaceId: workspace.id,
        kind: "discover",
        runSource,
        startedAt,
        finishedAt,
        status: result.status,
        summary: { added: result.added, notes: result.notes },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ORCHESTRATION_RUN_DB_LOG_FAILED", { workspaceId: workspace.id, message });
  }
}
