import { scheduleSlotKey } from "../time/jerusalem-day.js";
import { getWorkspace } from "./workspace-store.js";
import type { WorkspaceRecord } from "./workspace-types.js";

export async function claimScheduledSlot(
  workspace: WorkspaceRecord,
  kind: "apply" | "discover" | "outcome",
  runSource: "native_schedule" | "native_manual",
): Promise<{ ok: true; slotKey: string } | { ok: false; reason: string }> {
  if (runSource === "native_manual") {
    return { ok: true, slotKey: `${kind}:manual:${Date.now()}` };
  }
  const slotKey = scheduleSlotKey(kind, workspace.timezone);
  const fresh = await getWorkspace(workspace.id);
  const last = kind === "discover"
    ? fresh?.lastDiscoverRunKey
    : kind === "outcome"
      ? fresh?.lastOutcomeRunKey
      : fresh?.lastApplyRunKey;
  if (last === slotKey) {
    return { ok: false, reason: `slot_already_completed:${slotKey}` };
  }
  return { ok: true, slotKey };
}
