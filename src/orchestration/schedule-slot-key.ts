import { localScheduleParts } from "../time/jerusalem-day.js";
import type { WorkspaceRecord } from "./workspace-types.js";

export type ScheduleSlotKind = "apply" | "discover" | "outcome";

export function workspaceScheduleHour(workspace: WorkspaceRecord, kind: ScheduleSlotKind): number {
  if (kind === "discover") {
    return workspace.schedule.discoverHour;
  }
  if (kind === "outcome") {
    return workspace.schedule.outcomeHour;
  }
  return workspace.schedule.applyHour;
}

/** Stable once-per-day slot id using the workspace's configured hour (safe for catch-up after that hour). */
export function workspaceScheduleSlotKey(
  workspace: WorkspaceRecord,
  kind: ScheduleSlotKind,
  date = new Date(),
): string {
  const hour = workspaceScheduleHour(workspace, kind);
  const { date: day } = localScheduleParts(workspace.timezone, date);
  return `${kind}:${day}:${hour}`;
}

export function shouldCatchUpApplySlot(
  workspace: WorkspaceRecord,
  now: { date: string; hour: number },
  date = new Date(),
): boolean {
  if (now.hour < workspace.schedule.applyHour) {
    return false;
  }
  const slotKey = workspaceScheduleSlotKey(workspace, "apply", date);
  return workspace.lastApplyRunKey !== slotKey;
}

export function shouldMarkWorkspaceScheduleComplete(status: string): boolean {
  return status === "ok" || status === "skipped";
}
