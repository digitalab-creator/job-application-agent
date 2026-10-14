import { randomUUID } from "node:crypto";
import { log } from "../logging/logger.js";
import { withDb, workspaceDatabaseUrl } from "./db.js";

const SLOT_RUN_STALE_MS = 50 * 60 * 1000;

const processOwnerId = `${process.pid}:${randomUUID()}`;

export function scheduleSlotOwnerId(): string {
  return processOwnerId;
}

export type ScheduleSlotExecutionStatus = "running" | "completed" | "failed";

export type ScheduleSlotExecutionRow = {
  workspaceId: string;
  slotKey: string;
  status: ScheduleSlotExecutionStatus;
  ownerId: string;
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
};

export async function tryClaimScheduleSlotExecution(
  workspaceId: string,
  slotKey: string,
  ownerId = processOwnerId,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!workspaceDatabaseUrl()) {
    return { ok: true };
  }
  try {
    return await withDb(async (client) => {
      const existing = await client.query(
        `SELECT status, started_at FROM schedule_slot_executions
         WHERE workspace_id = $1 AND slot_key = $2`,
        [workspaceId, slotKey],
      );
      if ((existing.rowCount ?? 0) === 0) {
        await client.query(
          `INSERT INTO schedule_slot_executions (workspace_id, slot_key, status, owner_id)
           VALUES ($1, $2, 'running', $3)`,
          [workspaceId, slotKey, ownerId],
        );
        return { ok: true as const };
      }
      const row = existing.rows[0] as { status: string; started_at: Date };
      if (row.status === "completed") {
        return { ok: false as const, reason: `slot_execution_completed:${slotKey}` };
      }
      if (row.status === "running") {
        const ageMs = Date.now() - new Date(row.started_at).getTime();
        if (ageMs < SLOT_RUN_STALE_MS) {
          return { ok: false as const, reason: `slot_execution_in_progress:${slotKey}` };
        }
      }
      await client.query(
        `UPDATE schedule_slot_executions
         SET status = 'running', owner_id = $3, started_at = NOW(), finished_at = NULL, error_summary = NULL
         WHERE workspace_id = $1 AND slot_key = $2`,
        [workspaceId, slotKey, ownerId],
      );
      return { ok: true as const };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("SCHEDULE_SLOT_CLAIM_FAILED", { workspaceId, slotKey, message });
    return { ok: false, reason: `slot_claim_db_error:${message}` };
  }
}

export async function finalizeScheduleSlotExecution(
  workspaceId: string,
  slotKey: string,
  outcome: { status: "completed" | "failed"; errorSummary?: string },
): Promise<void> {
  if (!workspaceDatabaseUrl()) {
    return;
  }
  try {
    await withDb(async (client) => {
      await client.query(
        `UPDATE schedule_slot_executions
         SET status = $3, finished_at = NOW(), error_summary = $4
         WHERE workspace_id = $1 AND slot_key = $2`,
        [workspaceId, slotKey, outcome.status, outcome.errorSummary?.slice(0, 2000) ?? null],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("SCHEDULE_SLOT_FINALIZE_FAILED", { workspaceId, slotKey, message });
  }
}

export async function getScheduleSlotExecution(
  workspaceId: string,
  slotKey: string,
): Promise<ScheduleSlotExecutionRow | null> {
  if (!workspaceDatabaseUrl()) {
    return null;
  }
  return withDb(async (client) => {
    const res = await client.query(
      `SELECT workspace_id, slot_key, status, owner_id, started_at, finished_at, error_summary
       FROM schedule_slot_executions WHERE workspace_id = $1 AND slot_key = $2`,
      [workspaceId, slotKey],
    );
    if ((res.rowCount ?? 0) === 0) {
      return null;
    }
    const row = res.rows[0] as Record<string, unknown>;
    return {
      workspaceId: String(row.workspace_id),
      slotKey: String(row.slot_key),
      status: String(row.status) as ScheduleSlotExecutionStatus,
      ownerId: String(row.owner_id),
      startedAt: new Date(String(row.started_at)).toISOString(),
      finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
      errorSummary: row.error_summary ? String(row.error_summary) : null,
    };
  });
}
