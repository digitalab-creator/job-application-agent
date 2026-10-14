import { orchestrationMode } from "../config/env.js";
import { localScheduleParts } from "../time/jerusalem-day.js";
import { workspaceDatabaseUrl } from "./db.js";
import { computeQueueDepthSnapshot } from "./queue-depth.js";
import { getScheduleSlotExecution } from "./schedule-slot-execution.js";
import { readExcludeCompanies, readJobSheetRows } from "./sheets/job-sheet.js";
import { shouldCatchUpApplySlot, workspaceScheduleSlotKey } from "./schedule-slot-key.js";
import { getLatestOrchestrationRun, listEnabledWorkspaces } from "./workspace-store.js";
import type { WorkspaceRecord } from "./workspace-types.js";

export type WorkspaceReadinessSnapshot = {
  workspaceId: string;
  timezone: string;
  applyHour: number;
  applySlotKey: string;
  lastApplyRunKey: string | null;
  missedApplySlot: boolean;
  slotExecution: {
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorSummary: string | null;
  } | null;
  queue: {
    automatableEmployment: number;
    eligibleEmployment: number;
  } | null;
  sheetsRead: { ok: boolean; error?: string; rowCount?: number };
  lastApplyRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    notes: string;
  } | null;
};

export type OrchestrationReadiness = {
  ok: boolean;
  orchestrationMode: string;
  workspaceDatabaseConfigured: boolean;
  scheduler: {
    nativePollMs: number;
    catchUpEnabled: boolean;
    integratedDailyPipeline: boolean;
  };
  workspaces: WorkspaceReadinessSnapshot[];
  lastApplicationFailure: {
    workspaceId: string;
    startedAt: string;
    notes: string;
  } | null;
};

export async function buildOrchestrationReadiness(): Promise<OrchestrationReadiness> {
  const mode = orchestrationMode();
  const dbConfigured = Boolean(workspaceDatabaseUrl());
  const workspaces = dbConfigured ? await listEnabledWorkspaces() : [];
  const snapshots: WorkspaceReadinessSnapshot[] = [];
  let lastApplicationFailure: OrchestrationReadiness["lastApplicationFailure"] = null;

  for (const workspace of workspaces) {
    const snap = await workspaceReadiness(workspace);
    snapshots.push(snap);
    const failed = snap.lastApplyRun?.status === "error" ? snap.lastApplyRun : null;
    if (failed && (!lastApplicationFailure || failed.startedAt > lastApplicationFailure.startedAt)) {
      lastApplicationFailure = {
        workspaceId: workspace.id,
        startedAt: failed.startedAt,
        notes: failed.notes,
      };
    }
  }

  const sheetsHealthy = snapshots.every((s) => s.sheetsRead.ok);
  const missedWithoutCatchUp = snapshots.some((s) => s.missedApplySlot);
  const slotFailed = snapshots.some((s) => s.slotExecution?.status === "failed");
  const ok = mode === "native"
    && dbConfigured
    && sheetsHealthy
    && !missedWithoutCatchUp
    && !slotFailed;

  return {
    ok,
    orchestrationMode: mode,
    workspaceDatabaseConfigured: dbConfigured,
    scheduler: {
      nativePollMs: 60_000,
      catchUpEnabled: process.env.NATIVE_SCHEDULE_CATCHUP !== "false",
      integratedDailyPipeline: process.env.NATIVE_INTEGRATED_DAILY_PIPELINE !== "false",
    },
    workspaces: snapshots,
    lastApplicationFailure,
  };
}

async function workspaceReadiness(workspace: WorkspaceRecord): Promise<WorkspaceReadinessSnapshot> {
  const now = localScheduleParts(workspace.timezone);
  const applySlotKey = workspaceScheduleSlotKey(workspace, "apply");
  const missedApplySlot = shouldCatchUpApplySlot(workspace, now);
  const slotExecution = await getScheduleSlotExecution(workspace.id, applySlotKey);

  let sheetsRead: WorkspaceReadinessSnapshot["sheetsRead"] = { ok: false, error: "no_google_token" };
  let queue: WorkspaceReadinessSnapshot["queue"] = null;
  try {
    const rows = await readJobSheetRows(workspace);
    const excluded = await readExcludeCompanies(workspace);
    const depth = computeQueueDepthSnapshot(rows, excluded);
    queue = {
      automatableEmployment: depth.automatableEmployment,
      eligibleEmployment: depth.eligibleEmployment,
    };
    sheetsRead = { ok: true, rowCount: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sheetsRead = { ok: false, error: message.slice(0, 400) };
  }

  const lastRun = await getLatestOrchestrationRun(workspace.id, "apply");
  const lastApplyRun = lastRun
    ? {
        status: lastRun.status,
        startedAt: lastRun.startedAt,
        finishedAt: lastRun.finishedAt,
        notes: String((lastRun.summary.notes as string | undefined) ?? ""),
      }
    : null;

  return {
    workspaceId: workspace.id,
    timezone: workspace.timezone,
    applyHour: workspace.schedule.applyHour,
    applySlotKey,
    lastApplyRunKey: workspace.lastApplyRunKey,
    missedApplySlot,
    slotExecution: slotExecution
      ? {
          status: slotExecution.status,
          startedAt: slotExecution.startedAt,
          finishedAt: slotExecution.finishedAt,
          errorSummary: slotExecution.errorSummary,
        }
      : null,
    queue,
    sheetsRead,
    lastApplyRun,
  };
}
