import { recordPlatformAllocationIfNeeded } from "../budget/monthly-budget.js";
import { computeNewQueueStats } from "../discovery/queue-mix.js";
import { runDiscovery } from "../discovery/run-discovery.js";
import { log } from "../logging/logger.js";
import { appendNativeRunLog } from "./native-run-log.js";
import { readJobSheetRows, appendDiscoveredJobs } from "./sheets/job-sheet.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { withDb } from "./db.js";
import { insertOrchestrationRun, markWorkspaceRunKey } from "./workspace-store.js";
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
    recordPlatformAllocationIfNeeded();
    const rows = await readJobSheetRows(workspace);
    const existingUrls = rows
      .map((row) => String(row["Job URL"] ?? "").trim())
      .filter(Boolean);
    const newRows = rows.filter((row) => String(row.Status ?? "").trim() === "New");
    const newQueueStats = {
      ...computeNewQueueStats(newRows.map((row) => ({ category: String(row.Category ?? "") }))),
      statusNew: newRows.length,
    };
    const discovery = await runDiscovery({
      existingUrls,
      newQueueStats,
      boardUrls: workspace.discoveryBoardUrls,
    });
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
  const runKey = startedAt.slice(0, 16);
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
