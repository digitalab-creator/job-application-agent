import { log } from "../logging/logger.js";
import { localScheduleParts } from "../time/jerusalem-day.js";
import { runWorkspaceDailyPipeline } from "./daily-pipeline.js";
import { shouldCatchUpApplySlot } from "./schedule-slot-key.js";
import type { WorkspaceRecord } from "./workspace-types.js";

export async function runStartupApplyCatchUp(
  workspaces: WorkspaceRecord[],
  runPipeline: typeof runWorkspaceDailyPipeline = runWorkspaceDailyPipeline,
  now = new Date(),
): Promise<void> {
  if (process.env.NATIVE_SCHEDULE_CATCHUP === "false") {
    log("NATIVE_CATCHUP_SKIPPED", { reason: "NATIVE_SCHEDULE_CATCHUP=false" });
    return;
  }
  if (process.env.NATIVE_INTEGRATED_DAILY_PIPELINE === "false") {
    log("NATIVE_CATCHUP_SKIPPED", { reason: "integrated_pipeline_disabled" });
    return;
  }
  for (const workspace of workspaces) {
    const nowParts = localScheduleParts(workspace.timezone, now);
    if (!shouldCatchUpApplySlot(workspace, nowParts, now)) {
      continue;
    }
    log("NATIVE_CATCHUP_APPLY_START", {
      workspaceId: workspace.id,
      hour: nowParts.hour,
      applyHour: workspace.schedule.applyHour,
    });
    const result = await runPipeline({
      workspace,
      runSource: "native_schedule",
      submit: true,
      dryRun: false,
    });
    log("NATIVE_CATCHUP_APPLY_DONE", {
      workspaceId: workspace.id,
      status: result.status,
      applyRuns: result.applyRuns,
      discoverRuns: result.discoverRuns,
    });
  }
}
