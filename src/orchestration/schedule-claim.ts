import { getWorkspace } from "./workspace-store.js";
import type { WorkspaceRecord } from "./workspace-types.js";
import { tryClaimScheduleSlotExecution } from "./schedule-slot-execution.js";
import { workspaceScheduleSlotKey } from "./schedule-slot-key.js";

export type ScheduleSlotMode = "default" | "pipeline_inner";

export async function claimScheduledSlot(
  workspace: WorkspaceRecord,
  kind: "apply" | "discover" | "outcome",
  runSource: "native_schedule" | "native_manual",
): Promise<{ ok: true; slotKey: string } | { ok: false; reason: string }> {
  if (runSource === "native_manual") {
    return { ok: true, slotKey: `${kind}:manual:${Date.now()}` };
  }
  const slotKey = workspaceScheduleSlotKey(workspace, kind);
  const fresh = await getWorkspace(workspace.id);
  const last = kind === "discover"
    ? fresh?.lastDiscoverRunKey
    : kind === "outcome"
      ? fresh?.lastOutcomeRunKey
      : fresh?.lastApplyRunKey;
  if (last === slotKey) {
    return { ok: false, reason: `slot_already_completed:${slotKey}` };
  }
  const exec = await tryClaimScheduleSlotExecution(workspace.id, slotKey);
  if (!exec.ok) {
    return { ok: false, reason: exec.reason };
  }
  return { ok: true, slotKey };
}
