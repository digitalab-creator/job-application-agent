import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findAttemptInLedgers } from "./attempt-sources.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { withDb, workspaceDatabaseUrl } from "../orchestration/db.js";
import { log } from "../logging/logger.js";

export type McpIdempotencyState = "RESERVED" | "IN_PROGRESS" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export type McpIdempotencyScope = {
  tool: string;
  idempotencyKey: string;
  workspaceId: string;
  rowNumber: number;
  submit: boolean;
  jobUrl: string;
  company: string;
  role: string;
};

export type McpIdempotencyDecision =
  | { action: "proceed"; attemptId: string; state: McpIdempotencyState }
  | { action: "replay"; response: Record<string, unknown> }
  | { action: "reject"; error: string; state?: McpIdempotencyState }
  | { action: "wait"; error: string; state: McpIdempotencyState };

export function computeMcpRequestFingerprint(scope: McpIdempotencyScope): string {
  const payload = [
    scope.tool,
    scope.workspaceId,
    String(scope.rowNumber),
    scope.submit ? "1" : "0",
    scope.jobUrl.trim(),
    scope.company.trim(),
    scope.role.trim(),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

function fileStorePath(): string {
  const configured = process.env.MCP_IDEMPOTENCY_PATH?.trim();
  if (configured) {
    return configured;
  }
  const ledgerDir = path.dirname(process.env.LEDGER_PATH?.trim() || "/app/data/ledger");
  return path.join(ledgerDir, "mcp-apply-idempotency.jsonl");
}

type StoredRow = {
  key: string;
  tool: string;
  workspaceId: string;
  rowNumber: number;
  submit: boolean;
  fingerprint: string;
  state: McpIdempotencyState;
  attemptId?: string;
  response?: Record<string, unknown>;
  updatedAt: string;
};

function readFileRow(key: string, tool: string): StoredRow | null {
  const file = fileStorePath();
  if (!fs.existsSync(file)) {
    return null;
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const row = JSON.parse(lines[i]!) as StoredRow;
      if (row.key === key && row.tool === tool) {
        return row;
      }
    } catch {
      // skip
    }
  }
  return null;
}

function appendFileRow(row: StoredRow): void {
  const file = fileStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

function reconcileUncertainAttempt(workspace: WorkspaceRecord, attemptId: string): McpIdempotencyState {
  const { record } = findAttemptInLedgers(attemptId, workspace);
  if (!record) {
    return "UNKNOWN";
  }
  if (record.submitted || record.pipeline?.submitted) {
    if (record.confirmationDetected) {
      return "CONFIRMED";
    }
    return "UNKNOWN";
  }
  if (record.outcome === "applied" || record.blocker === "submitted_unconfirmed") {
    return "UNKNOWN";
  }
  return "FAILED";
}

async function readDbRow(key: string, tool: string): Promise<StoredRow | null> {
  return withDb(async (client) => {
    const res = await client.query(
      `SELECT idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json, updated_at
       FROM mcp_tool_idempotency WHERE idempotency_key = $1 AND tool = $2`,
      [key, tool],
    );
    const row = res.rows[0];
    if (!row) {
      return null;
    }
    return {
      key: String(row.idempotency_key),
      tool: String(row.tool),
      workspaceId: String(row.workspace_id),
      rowNumber: Number(row.row_number),
      submit: Boolean(row.submit),
      fingerprint: String(row.request_fingerprint),
      state: String(row.state) as McpIdempotencyState,
      attemptId: row.attempt_id ? String(row.attempt_id) : undefined,
      response: row.response_json as Record<string, unknown> | undefined,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
}

async function writeDbRow(row: StoredRow): Promise<void> {
  await withDb(async (client) => {
    await client.query(
      `INSERT INTO mcp_tool_idempotency
         (idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
       ON CONFLICT (idempotency_key, tool) DO UPDATE SET
         state = EXCLUDED.state,
         attempt_id = EXCLUDED.attempt_id,
         response_json = EXCLUDED.response_json,
         updated_at = NOW()`,
      [
        row.key,
        row.tool,
        row.workspaceId,
        row.rowNumber,
        row.submit,
        row.fingerprint,
        row.state,
        row.attemptId ?? null,
        row.response ? JSON.stringify(row.response) : null,
      ],
    );
  });
}

const STALE_IN_PROGRESS_MINUTES = Math.max(
  5,
  Math.floor(Number(process.env.MCP_IDEMPOTENCY_STALE_MINUTES ?? "45")),
);

async function claimInProgressDb(
  scope: McpIdempotencyScope,
  fingerprint: string,
  attemptId: string,
  fromStates: McpIdempotencyState[],
  allowStaleOnly: boolean,
): Promise<StoredRow | null> {
  return withDb(async (client) => {
    const res = await client.query(
      `UPDATE mcp_tool_idempotency
         SET state = 'IN_PROGRESS', attempt_id = $4, updated_at = NOW()
       WHERE idempotency_key = $1
         AND tool = $2
         AND request_fingerprint = $3
         AND state = ANY($5::text[])
         AND (
           $6::boolean = false
           OR updated_at < NOW() - ($7::text || ' minutes')::interval
         )
       RETURNING idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json, updated_at`,
      [
        scope.idempotencyKey,
        scope.tool,
        fingerprint,
        attemptId,
        fromStates,
        allowStaleOnly,
        String(STALE_IN_PROGRESS_MINUTES),
      ],
    );
    const row = res.rows[0];
    if (!row) {
      return null;
    }
    return {
      key: String(row.idempotency_key),
      tool: String(row.tool),
      workspaceId: String(row.workspace_id),
      rowNumber: Number(row.row_number),
      submit: Boolean(row.submit),
      fingerprint: String(row.request_fingerprint),
      state: "IN_PROGRESS",
      attemptId: String(row.attempt_id),
      response: row.response_json as Record<string, unknown> | undefined,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
}

async function reserveDb(scope: McpIdempotencyScope, fingerprint: string, attemptId: string): Promise<StoredRow | null> {
  return withDb(async (client) => {
    const insert = await client.query(
      `INSERT INTO mcp_tool_idempotency
         (idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id)
       VALUES ($1,$2,$3,$4,$5,$6,'RESERVED',$7)
       ON CONFLICT (idempotency_key, tool) DO NOTHING
       RETURNING idempotency_key`,
      [scope.idempotencyKey, scope.tool, scope.workspaceId, scope.rowNumber, scope.submit, fingerprint, attemptId],
    );
    if ((insert.rowCount ?? 0) > 0) {
      return {
        key: scope.idempotencyKey,
        tool: scope.tool,
        workspaceId: scope.workspaceId,
        rowNumber: scope.rowNumber,
        submit: scope.submit,
        fingerprint,
        state: "RESERVED",
        attemptId,
        updatedAt: new Date().toISOString(),
      };
    }
    return null;
  });
}

function decideFromStored(
  stored: StoredRow,
  fingerprint: string,
  workspace: WorkspaceRecord,
): McpIdempotencyDecision {
  if (stored.fingerprint !== fingerprint) {
    return { action: "reject", error: "idempotency_key_reused_with_different_arguments", state: stored.state };
  }
  if (stored.state === "CONFIRMED" && stored.response) {
    return { action: "replay", response: stored.response };
  }
  if (stored.state === "IN_PROGRESS" || stored.state === "RESERVED") {
    const updatedMs = Date.parse(stored.updatedAt);
    const stale =
      Number.isFinite(updatedMs)
      && Date.now() - updatedMs > STALE_IN_PROGRESS_MINUTES * 60_000;
    if (!stale) {
      return { action: "wait", error: "idempotency_in_progress", state: stored.state };
    }
    return { action: "proceed", attemptId: stored.attemptId ?? randomUUID(), state: stored.state };
  }
  if (stored.state === "UNKNOWN") {
    return { action: "reject", error: "prior_submission_outcome_uncertain", state: "UNKNOWN" };
  }
  if (stored.state === "FAILED" && stored.attemptId) {
    const reconciled = reconcileUncertainAttempt(workspace, stored.attemptId);
    if (reconciled === "UNKNOWN" || reconciled === "CONFIRMED") {
      return { action: "reject", error: "prior_submission_outcome_uncertain", state: reconciled };
    }
  }
  if (stored.state === "FAILED") {
    return {
      action: "proceed",
      attemptId: stored.attemptId ?? randomUUID(),
      state: "FAILED",
    };
  }
  return { action: "reject", error: `idempotency_state_${stored.state.toLowerCase()}`, state: stored.state };
}

export async function beginMcpIdempotency(
  workspace: WorkspaceRecord,
  scope: McpIdempotencyScope,
  attemptId: string,
): Promise<McpIdempotencyDecision> {
  const fingerprint = computeMcpRequestFingerprint(scope);
  const useDb = Boolean(workspaceDatabaseUrl());

  if (useDb) {
    try {
      const reserved = await reserveDb(scope, fingerprint, attemptId);
      if (reserved) {
        await writeDbRow({ ...reserved, state: "IN_PROGRESS" });
        return { action: "proceed", attemptId, state: "IN_PROGRESS" };
      }
      const existing = await readDbRow(scope.idempotencyKey, scope.tool);
      if (!existing) {
        return { action: "reject", error: "idempotency_reserve_failed" };
      }
      const decision = decideFromStored(existing, fingerprint, workspace);
      if (decision.action === "proceed") {
        if (existing.state === "FAILED") {
          const claimed = await claimInProgressDb(scope, fingerprint, attemptId, ["FAILED"], false);
          if (!claimed) {
            const latest = await readDbRow(scope.idempotencyKey, scope.tool);
            if (latest) {
              return decideFromStored(latest, fingerprint, workspace);
            }
            return { action: "reject", error: "idempotency_retry_claim_failed" };
          }
          return { action: "proceed", attemptId, state: "IN_PROGRESS" };
        }
        if (existing.state === "RESERVED" || existing.state === "IN_PROGRESS") {
          const claimed = await claimInProgressDb(
            scope,
            fingerprint,
            attemptId,
            ["RESERVED", "IN_PROGRESS"],
            true,
          );
          if (!claimed) {
            return { action: "wait", error: "idempotency_in_progress", state: existing.state };
          }
          return { action: "proceed", attemptId, state: "IN_PROGRESS" };
        }
        await writeDbRow({ ...existing, state: "IN_PROGRESS", attemptId, updatedAt: new Date().toISOString() });
        return { action: "proceed", attemptId, state: "IN_PROGRESS" };
      }
      return decision;
    } catch (error) {
      log("MCP_IDEMPOTENCY_DB_FAILED", {
        message: error instanceof Error ? error.message : String(error),
      });
      return { action: "reject", error: "idempotency_store_unavailable" };
    }
  }

  const lockFile = `${fileStorePath()}.${scope.idempotencyKey}.lock`;
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    const fd = fs.openSync(lockFile, "wx");
    fs.closeSync(fd);
  } catch {
    const existing = readFileRow(scope.idempotencyKey, scope.tool);
    if (!existing) {
      return { action: "wait", error: "idempotency_in_progress", state: "IN_PROGRESS" };
    }
    return decideFromStored(existing, fingerprint, workspace);
  }

  try {
    const existing = readFileRow(scope.idempotencyKey, scope.tool);
    if (existing) {
      const decision = decideFromStored(existing, fingerprint, workspace);
      if (decision.action !== "proceed") {
        return decision;
      }
    }
    const row: StoredRow = {
      key: scope.idempotencyKey,
      tool: scope.tool,
      workspaceId: scope.workspaceId,
      rowNumber: scope.rowNumber,
      submit: scope.submit,
      fingerprint,
      state: "IN_PROGRESS",
      attemptId,
      updatedAt: new Date().toISOString(),
    };
    appendFileRow(row);
    return { action: "proceed", attemptId, state: "IN_PROGRESS" };
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // ignore
    }
  }
}

export async function finishMcpIdempotency(
  scope: McpIdempotencyScope,
  attemptId: string,
  outcome: { state: McpIdempotencyState; response?: Record<string, unknown> },
): Promise<void> {
  const fingerprint = computeMcpRequestFingerprint(scope);
  const row: StoredRow = {
    key: scope.idempotencyKey,
    tool: scope.tool,
    workspaceId: scope.workspaceId,
    rowNumber: scope.rowNumber,
    submit: scope.submit,
    fingerprint,
    state: outcome.state,
    attemptId,
    response: outcome.response,
    updatedAt: new Date().toISOString(),
  };
  if (workspaceDatabaseUrl()) {
    try {
      await writeDbRow(row);
      return;
    } catch (error) {
      log("MCP_IDEMPOTENCY_FINISH_DB_FAILED", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  appendFileRow(row);
}

export async function markMcpIdempotencyUncertain(scope: McpIdempotencyScope, attemptId: string): Promise<void> {
  await finishMcpIdempotency(scope, attemptId, { state: "UNKNOWN" });
}
