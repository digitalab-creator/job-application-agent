import { finalizeScheduleSlotExecution } from "./schedule-slot-execution.js";
import {
  shouldMarkWorkspaceScheduleComplete,
  workspaceScheduleSlotKey,
  type ScheduleSlotKind,
} from "./schedule-slot-key.js";
import { markWorkspaceRunKey } from "./workspace-store.js";
import type { WorkspaceRecord } from "./workspace-types.js";

export async function finishScheduledSlotIfNeeded(input: {
  workspace: WorkspaceRecord;
  kind: ScheduleSlotKind;
  runSource: "native_schedule" | "native_manual";
  scheduleSlot: "default" | "pipeline_inner";
  startedAt: string;
  status: string;
  errorSummary?: string;
}): Promise<void> {
  if (input.runSource !== "native_schedule" || input.scheduleSlot === "pipeline_inner") {
    return;
  }
  const slotKey = workspaceScheduleSlotKey(input.workspace, input.kind, new Date(input.startedAt));
  if (shouldMarkWorkspaceScheduleComplete(input.status)) {
    await markWorkspaceRunKey(input.workspace.id, input.kind, slotKey);
    await finalizeScheduleSlotExecution(input.workspace.id, slotKey, { status: "completed" });
    return;
  }
  if (input.status === "error" || input.status === "locked") {
    await finalizeScheduleSlotExecution(input.workspace.id, slotKey, {
      status: "failed",
      errorSummary: input.errorSummary ?? input.status,
    });
  }
}
