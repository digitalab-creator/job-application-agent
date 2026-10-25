import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeCanonicalJobDedupKey } from "./canonical-job-submit-guard.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { withDb, workspaceDatabaseUrl } from "../orchestration/db.js";
import { log } from "../logging/logger.js";
import {
  reconcileSubmitAttempt,
  type McpSubmissionStage,
  type ReconcileOutcome,
} from "./mcp-idempotency-reconcile.js";

export type McpIdempotencyState =
  | "RESERVED"
  | "IN_PROGRESS"
  | "CONFIRMED"
  | "FAILED"
  | "UNKNOWN"
  | "RECONCILIATION_REQUIRED";

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
  | { action: "proceed"; attemptId: string; state: McpIdempotencyState; ownerToken: string }
  | { action: "replay"; response: Record<string, unknown> }
  | { action: "reject"; error: string; state?: McpIdempotencyState }
  | { action: "wait"; error: string; state: McpIdempotencyState };

const ACTIVE_SUBMIT_STATES: McpIdempotencyState[] = [
  "RESERVED",
  "IN_PROGRESS",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
  "CONFIRMED",
];

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
  jobDedupKey?: string;
  submissionStage?: McpSubmissionStage | null;
  ownerToken?: string;
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

function reconcileToIdempotencyState(
  workspace: WorkspaceRecord,
  stored: StoredRow,
): ReconcileOutcome {
  if (!stored.attemptId) {
    return "UNKNOWN";
  }
  return reconcileSubmitAttempt({
    attemptId: stored.attemptId,
    workspace,
    submissionStage: stored.submissionStage ?? null,
  });
}

async function readDbRow(key: string, tool: string): Promise<StoredRow | null> {
  return withDb(async (client) => {
    const res = await client.query(
      `SELECT idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json, updated_at,
              job_dedup_key, submission_stage, owner_token
       FROM mcp_tool_idempotency WHERE idempotency_key = $1 AND tool = $2`,
      [key, tool],
    );
    const row = res.rows[0];
    if (!row) {
      return null;
    }
    return rowFromDb(row);
  });
}

function rowFromDb(row: Record<string, unknown>): StoredRow {
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
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
    jobDedupKey: row.job_dedup_key ? String(row.job_dedup_key) : undefined,
    submissionStage: row.submission_stage ? String(row.submission_stage) as McpSubmissionStage : null,
    ownerToken: row.owner_token ? String(row.owner_token) : undefined,
  };
}

async function writeDbRow(row: StoredRow, expectedOwnerToken?: string | null): Promise<boolean> {
  return withDb(async (client) => {
    const res = await client.query(
      `INSERT INTO mcp_tool_idempotency
         (idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json,
          job_dedup_key, submission_stage, owner_token, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,NOW())
       ON CONFLICT (idempotency_key, tool) DO UPDATE SET
         state = EXCLUDED.state,
         attempt_id = EXCLUDED.attempt_id,
         response_json = EXCLUDED.response_json,
         job_dedup_key = EXCLUDED.job_dedup_key,
         submission_stage = COALESCE(EXCLUDED.submission_stage, mcp_tool_idempotency.submission_stage),
         owner_token = COALESCE(EXCLUDED.owner_token, mcp_tool_idempotency.owner_token),
         updated_at = NOW()
       WHERE $13::text IS NULL OR mcp_tool_idempotency.owner_token IS NULL OR mcp_tool_idempotency.owner_token = $13`,
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
        row.jobDedupKey ?? null,
        row.submissionStage ?? null,
        row.ownerToken ?? null,
        expectedOwnerToken ?? null,
      ],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

async function findConflictingJobSubmitRow(
  scope: McpIdempotencyScope,
  jobDedupKey: string,
): Promise<StoredRow | null> {
  return withDb(async (client) => {
    const res = await client.query(
      `SELECT idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json, updated_at,
              job_dedup_key, submission_stage, owner_token
       FROM mcp_tool_idempotency
       WHERE workspace_id = $1
         AND job_dedup_key = $2
         AND submit = true
         AND tool = $3
         AND idempotency_key <> $4
         AND state = ANY($5::text[])
       ORDER BY updated_at DESC
       LIMIT 1`,
      [scope.workspaceId, jobDedupKey, scope.tool, scope.idempotencyKey, ACTIVE_SUBMIT_STATES],
    );
    const row = res.rows[0];
    return row ? rowFromDb(row) : null;
  });
}

async function claimInProgressDb(
  scope: McpIdempotencyScope,
  fingerprint: string,
  attemptId: string,
  ownerToken: string,
  fromStates: McpIdempotencyState[],
  jobDedupKey: string | null,
): Promise<StoredRow | null> {
  return withDb(async (client) => {
    const res = await client.query(
      `UPDATE mcp_tool_idempotency
         SET state = 'IN_PROGRESS', attempt_id = $4, owner_token = $5, job_dedup_key = COALESCE($6, job_dedup_key), updated_at = NOW()
       WHERE idempotency_key = $1
         AND tool = $2
         AND request_fingerprint = $3
         AND state = ANY($7::text[])
       RETURNING idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json, updated_at,
                 job_dedup_key, submission_stage, owner_token`,
      [
        scope.idempotencyKey,
        scope.tool,
        fingerprint,
        attemptId,
        ownerToken,
        jobDedupKey,
        fromStates,
      ],
    );
    const row = res.rows[0];
    if (!row) {
      return null;
    }
    return rowFromDb(row);
  });
}

async function reserveDb(
  scope: McpIdempotencyScope,
  fingerprint: string,
  attemptId: string,
  ownerToken: string,
  jobDedupKey: string | null,
): Promise<StoredRow | null> {
  return withDb(async (client) => {
    const insert = await client.query(
      `INSERT INTO mcp_tool_idempotency
         (idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, owner_token, job_dedup_key)
       VALUES ($1,$2,$3,$4,$5,$6,'RESERVED',$7,$8,$9)
       ON CONFLICT (idempotency_key, tool) DO NOTHING
       RETURNING idempotency_key`,
      [
        scope.idempotencyKey,
        scope.tool,
        scope.workspaceId,
        scope.rowNumber,
        scope.submit,
        fingerprint,
        attemptId,
        ownerToken,
        jobDedupKey,
      ],
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
        ownerToken,
        jobDedupKey: jobDedupKey ?? undefined,
        updatedAt: new Date().toISOString(),
      };
    }
    return null;
  });
}

function uncertainReject(state: McpIdempotencyState): McpIdempotencyDecision {
  return { action: "reject", error: "prior_submission_outcome_uncertain", state };
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
  if (stored.state === "UNKNOWN" || stored.state === "RECONCILIATION_REQUIRED") {
    return uncertainReject(stored.state);
  }
  if (stored.state === "IN_PROGRESS" || stored.state === "RESERVED") {
    if (stored.submit) {
      const reconciled = reconcileToIdempotencyState(workspace, stored);
      if (reconciled === "CONFIRMED") {
        if (stored.response) {
          return { action: "replay", response: stored.response };
        }
        return uncertainReject("UNKNOWN");
      }
      if (stored.state === "IN_PROGRESS") {
        if (stored.submissionStage) {
          return uncertainReject("UNKNOWN");
        }
        return { action: "wait", error: "idempotency_in_progress", state: stored.state };
      }
      if (stored.state === "RESERVED" && reconciled === "FAILED_SAFE" && !stored.submissionStage) {
        return {
          action: "proceed",
          attemptId: stored.attemptId ?? randomUUID(),
          state: stored.state,
          ownerToken: stored.ownerToken ?? randomUUID(),
        };
      }
      return { action: "wait", error: "idempotency_in_progress", state: stored.state };
    }
    const updatedMs = Date.parse(stored.updatedAt);
    const staleMinutes = Math.max(5, Math.floor(Number(process.env.MCP_IDEMPOTENCY_STALE_MINUTES ?? "45")));
    const stale = Number.isFinite(updatedMs) && Date.now() - updatedMs > staleMinutes * 60_000;
    if (!stale) {
      return { action: "wait", error: "idempotency_in_progress", state: stored.state };
    }
    return {
      action: "proceed",
      attemptId: stored.attemptId ?? randomUUID(),
      state: stored.state,
      ownerToken: stored.ownerToken ?? randomUUID(),
    };
  }
  if (stored.state === "FAILED" && stored.submit && stored.attemptId) {
    const reconciled = reconcileToIdempotencyState(workspace, stored);
    if (reconciled !== "FAILED_SAFE") {
      return uncertainReject(reconciled === "CONFIRMED" ? "CONFIRMED" : "UNKNOWN");
    }
  }
  if (stored.state === "FAILED") {
    return {
      action: "proceed",
      attemptId: stored.attemptId ?? randomUUID(),
      state: "FAILED",
      ownerToken: randomUUID(),
    };
  }
  return { action: "reject", error: `idempotency_state_${stored.state.toLowerCase()}`, state: stored.state };
}

async function rejectIfJobSubmitConflict(
  scope: McpIdempotencyScope,
  jobDedupKey: string | null,
): Promise<McpIdempotencyDecision | null> {
  if (!scope.submit || !jobDedupKey || !workspaceDatabaseUrl()) {
    return null;
  }
  const conflict = await findConflictingJobSubmitRow(scope, jobDedupKey);
  if (!conflict) {
    return null;
  }
  return {
    action: "reject",
    error: "canonical_job_submit_already_active",
    state: conflict.state,
  };
}

export async function beginMcpIdempotency(
  workspace: WorkspaceRecord,
  scope: McpIdempotencyScope,
  attemptId: string,
): Promise<McpIdempotencyDecision> {
  const fingerprint = computeMcpRequestFingerprint(scope);
  const ownerToken = randomUUID();
  const jobDedupKey = scope.submit ? computeCanonicalJobDedupKey(scope.workspaceId, scope.jobUrl) : null;
  const useDb = Boolean(workspaceDatabaseUrl());

  if (useDb) {
    try {
      const jobConflict = await rejectIfJobSubmitConflict(scope, jobDedupKey);
      if (jobConflict) {
        return jobConflict;
      }

      const reserved = await reserveDb(scope, fingerprint, attemptId, ownerToken, jobDedupKey);
      if (reserved) {
        const row: StoredRow = { ...reserved, state: "IN_PROGRESS", ownerToken };
        await writeDbRow(row);
        return { action: "proceed", attemptId, state: "IN_PROGRESS", ownerToken };
      }
      const existing = await readDbRow(scope.idempotencyKey, scope.tool);
      if (!existing) {
        return { action: "reject", error: "idempotency_reserve_failed" };
      }
      const decision = decideFromStored(existing, fingerprint, workspace);
      if (decision.action === "proceed") {
        const proceedOwner = decision.ownerToken;
        const proceedAttempt = decision.attemptId;
        if (existing.state === "FAILED") {
          const claimed = await claimInProgressDb(
            scope,
            fingerprint,
            proceedAttempt,
            proceedOwner,
            ["FAILED"],
            jobDedupKey,
          );
          if (!claimed) {
            const latest = await readDbRow(scope.idempotencyKey, scope.tool);
            if (latest) {
              return decideFromStored(latest, fingerprint, workspace);
            }
            return { action: "reject", error: "idempotency_retry_claim_failed" };
          }
          return { action: "proceed", attemptId: proceedAttempt, state: "IN_PROGRESS", ownerToken: proceedOwner };
        }
        if (!existing.submit && (existing.state === "RESERVED" || existing.state === "IN_PROGRESS")) {
          const claimed = await claimInProgressDb(
            scope,
            fingerprint,
            proceedAttempt,
            proceedOwner,
            ["RESERVED", "IN_PROGRESS"],
            jobDedupKey,
          );
          if (!claimed) {
            const latest = await readDbRow(scope.idempotencyKey, scope.tool);
            if (latest) {
              return decideFromStored(latest, fingerprint, workspace);
            }
            return { action: "reject", error: "idempotency_retry_claim_failed" };
          }
          return { action: "proceed", attemptId: proceedAttempt, state: "IN_PROGRESS", ownerToken: proceedOwner };
        }
        if (existing.state === "RESERVED" && existing.submit) {
          const reconciled = reconcileToIdempotencyState(workspace, existing);
          if (reconciled !== "FAILED_SAFE") {
            return uncertainReject(reconciled === "CONFIRMED" ? "CONFIRMED" : "UNKNOWN");
          }
          const claimed = await claimInProgressDb(
            scope,
            fingerprint,
            proceedAttempt,
            proceedOwner,
            ["RESERVED"],
            jobDedupKey,
          );
          if (!claimed) {
            return { action: "wait", error: "idempotency_in_progress", state: existing.state };
          }
          return { action: "proceed", attemptId: proceedAttempt, state: "IN_PROGRESS", ownerToken: proceedOwner };
        }
        await writeDbRow({
          ...existing,
          state: "IN_PROGRESS",
          attemptId: proceedAttempt,
          ownerToken: proceedOwner,
          updatedAt: new Date().toISOString(),
        });
        return { action: "proceed", attemptId: proceedAttempt, state: "IN_PROGRESS", ownerToken: proceedOwner };
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
      ownerToken,
      updatedAt: new Date().toISOString(),
    };
    appendFileRow(row);
    return { action: "proceed", attemptId, state: "IN_PROGRESS", ownerToken };
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // ignore
    }
  }
}

export async function recordMcpSubmissionStage(
  scope: McpIdempotencyScope,
  attemptId: string,
  ownerToken: string,
  stage: McpSubmissionStage,
): Promise<void> {
  const fingerprint = computeMcpRequestFingerprint(scope);
  const jobDedupKey = scope.submit ? computeCanonicalJobDedupKey(scope.workspaceId, scope.jobUrl) : null;
  const patch: StoredRow = {
    key: scope.idempotencyKey,
    tool: scope.tool,
    workspaceId: scope.workspaceId,
    rowNumber: scope.rowNumber,
    submit: scope.submit,
    fingerprint,
    state: "IN_PROGRESS",
    attemptId,
    ownerToken,
    submissionStage: stage,
    jobDedupKey: jobDedupKey ?? undefined,
    updatedAt: new Date().toISOString(),
  };
  if (workspaceDatabaseUrl()) {
    const wrote = await writeDbRow(patch, ownerToken);
    if (!wrote) {
      log("MCP_SUBMISSION_STAGE_FENCE_REJECTED", { stage, attemptId });
    }
    return;
  }
  appendFileRow(patch);
}

export async function finishMcpIdempotency(
  scope: McpIdempotencyScope,
  attemptId: string,
  outcome: { state: McpIdempotencyState; response?: Record<string, unknown> },
  ownerToken?: string,
): Promise<void> {
  const fingerprint = computeMcpRequestFingerprint(scope);
  const jobDedupKey = scope.submit ? computeCanonicalJobDedupKey(scope.workspaceId, scope.jobUrl) : null;
  const row: StoredRow = {
    key: scope.idempotencyKey,
    tool: scope.tool,
    workspaceId: scope.workspaceId,
    rowNumber: scope.rowNumber,
    submit: scope.submit,
    fingerprint,
    state: outcome.state,
    attemptId,
    ownerToken,
    response: outcome.response,
    jobDedupKey: jobDedupKey ?? undefined,
    updatedAt: new Date().toISOString(),
  };
  if (workspaceDatabaseUrl()) {
    try {
      const wrote = await writeDbRow(row, ownerToken ?? null);
      if (!wrote) {
        log("MCP_IDEMPOTENCY_FINISH_FENCED", { attemptId, state: outcome.state });
      }
      return;
    } catch (error) {
      log("MCP_IDEMPOTENCY_FINISH_DB_FAILED", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  appendFileRow(row);
}

export async function markMcpIdempotencyUncertain(
  scope: McpIdempotencyScope,
  attemptId: string,
  ownerToken?: string,
): Promise<void> {
  await finishMcpIdempotency(scope, attemptId, { state: "UNKNOWN" }, ownerToken);
}

export async function confirmMcpIdempotencyLate(
  scope: McpIdempotencyScope,
  attemptId: string,
  response: Record<string, unknown>,
  ownerToken?: string,
): Promise<boolean> {
  const existing = workspaceDatabaseUrl() ? await readDbRow(scope.idempotencyKey, scope.tool) : readFileRow(scope.idempotencyKey, scope.tool);
  if (!existing || existing.attemptId !== attemptId) {
    return false;
  }
  if (existing.state !== "UNKNOWN" && existing.state !== "RECONCILIATION_REQUIRED" && existing.state !== "IN_PROGRESS") {
    return false;
  }
  await finishMcpIdempotency(scope, attemptId, { state: "CONFIRMED", response }, ownerToken ?? existing.ownerToken);
  return true;
}

export type McpIdempotencyPublicRecord = {
  idempotencyKey: string;
  tool: string;
  workspaceId: string;
  rowNumber: number;
  submit: boolean;
  state: McpIdempotencyState;
  attemptId?: string;
  submissionStage?: McpSubmissionStage | null;
  updatedAt: string;
};

function toPublicRecord(row: StoredRow): McpIdempotencyPublicRecord {
  return {
    idempotencyKey: row.key,
    tool: row.tool,
    workspaceId: row.workspaceId,
    rowNumber: row.rowNumber,
    submit: row.submit,
    state: row.state,
    attemptId: row.attemptId,
    submissionStage: row.submissionStage ?? null,
    updatedAt: row.updatedAt,
  };
}

function readFileRowByAttemptId(attemptId: string, workspaceId: string): StoredRow | null {
  const file = fileStorePath();
  if (!fs.existsSync(file)) {
    return null;
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const row = JSON.parse(lines[i]!) as StoredRow;
      if (row.attemptId === attemptId && row.workspaceId === workspaceId) {
        return row;
      }
    } catch {
      // skip
    }
  }
  return null;
}

export async function findMcpIdempotencyForScope(
  scope: Pick<McpIdempotencyScope, "idempotencyKey" | "tool">,
): Promise<McpIdempotencyPublicRecord | null> {
  if (workspaceDatabaseUrl()) {
    try {
      const row = await readDbRow(scope.idempotencyKey, scope.tool);
      return row ? toPublicRecord(row) : null;
    } catch {
      return null;
    }
  }
  const row = readFileRow(scope.idempotencyKey, scope.tool);
  return row ? toPublicRecord(row) : null;
}

export async function findMcpIdempotencyByAttemptId(
  attemptId: string,
  workspaceId: string,
): Promise<McpIdempotencyPublicRecord | null> {
  const trimmed = attemptId.trim();
  if (!trimmed) {
    return null;
  }
  if (workspaceDatabaseUrl()) {
    try {
      const row = await withDb(async (client) => {
        const res = await client.query(
          `SELECT idempotency_key, tool, workspace_id, row_number, submit, request_fingerprint, state, attempt_id, response_json, updated_at,
                  job_dedup_key, submission_stage, owner_token
           FROM mcp_tool_idempotency
           WHERE attempt_id = $1 AND workspace_id = $2
           ORDER BY updated_at DESC
           LIMIT 1`,
          [trimmed, workspaceId],
        );
        const hit = res.rows[0];
        return hit ? rowFromDb(hit) : null;
      });
      return row ? toPublicRecord(row) : null;
    } catch (error) {
      log("MCP_IDEMPOTENCY_LOOKUP_FAILED", {
        attemptId: trimmed,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const fileRow = readFileRowByAttemptId(trimmed, workspaceId);
  return fileRow ? toPublicRecord(fileRow) : null;
}
