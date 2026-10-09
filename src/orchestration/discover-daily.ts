import { recordPlatformAllocationIfNeeded } from "../budget/monthly-budget.js";
import { computeQueueDepthSnapshot } from "./queue-depth.js";
import { withSearchPolicy } from "../config/search-policy-runtime.js";
import { runDiscovery } from "../discovery/run-discovery.js";
import { loadSearchPolicyFromSheet } from "./sheets/search-config.js";
import { log } from "../logging/logger.js";
import { appendNativeRunLog } from "./native-run-log.js";
import { appendDiscoveredJobs, readExcludeCompanies, readJobSheetRows } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { withDb } from "./db.js";
import { insertOrchestrationRun, markWorkspaceRunKey } from "./workspace-store.js";
import { scheduleSlotKey } from "../time/jerusalem-day.js";
import { claimScheduledSlot } from "./schedule-claim.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "./workspace-runtime.js";
export type DiscoverDailyOptions = {
  workspace: WorkspaceRecord;
  runSource: "native_schedule" | "native_manual";
  dryRun: boolean;
};

export type DiscoverDailyResult = {
  status: "ok" | "skipped" | "error";
  added: number;
  notes: string;
};

export async function runWorkspaceDiscoverDaily(options: DiscoverDailyOptions): Promise<DiscoverDailyResult> {
  const { workspace, runSource, dryRun } = options;
  return withWorkspaceRuntime(runtimeFromWorkspace(workspace, runSource), async () => {
  const startedAt = new Date().toISOString();
  let added = 0;
  try {
    const claim = await claimScheduledSlot(workspace, "discover", runSource);
    if (!claim.ok) {
      const result: DiscoverDailyResult = {
        status: "skipped",
        added: 0,
        notes: claim.reason,
      };
      return result;
    }
    recordPlatformAllocationIfNeeded();
    const rows = await readJobSheetRows(workspace);
    const excluded = await readExcludeCompanies(workspace);
    const existingUrls = rows
      .map((row) => String(row["Job URL"] ?? "").trim())
      .filter(Boolean);
    const depth = computeQueueDepthSnapshot(rows, excluded);
    const newQueueStats = {
      ...depth.mix,
      statusNew: depth.eligibleEmployment,
    };
    const searchPolicy = await loadSearchPolicyFromSheet(workspace);
    const discovery = await withSearchPolicy(searchPolicy, async () => runDiscovery({
      existingUrls,
      newQueueStats,
      boardUrls: workspace.discoveryBoardUrls,
      sheetRows: rows,
    }));
    if (discovery.status !== "ok" || discovery.jobs.length === 0) {
      const result: DiscoverDailyResult = {
        status: discovery.status === "ok" ? "skipped" : discovery.status === "budget_reached" ? "skipped" : "skipped",
        added: 0,
        notes: discovery.notes,
      };
      await finishRun(workspace, runSource, startedAt, result);
      return result;
    }
    const sheetRows = discovery.jobs.map((job) => {
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
        Status: "New",
        Notes: `${header}\n${discovery.notes || ""}`.trim(),
      };
    });
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
    await finishRun(workspace, runSource, startedAt, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("DISCOVER_DAILY_FAILED", { workspaceId: workspace.id, message });
    const result: DiscoverDailyResult = { status: "error", added, notes: message };
    await finishRun(workspace, runSource, startedAt, result);
    return result;
  }
  });
}

async function finishRun(
  workspace: WorkspaceRecord,
  runSource: "native_schedule" | "native_manual",
  startedAt: string,
  result: DiscoverDailyResult,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  const runKey = runSource === "native_schedule"
    ? scheduleSlotKey("discover", workspace.timezone, new Date(startedAt))
    : startedAt.slice(0, 16);
  await markWorkspaceRunKey(workspace.id, "discover", runKey);
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
