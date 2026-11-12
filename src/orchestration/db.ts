import type { Pool, PoolClient } from "pg";
import { log } from "../logging/logger.js";

let pool: Pool | null = null;

export function workspaceDatabaseUrl(): string | null {
  const url = process.env.WORKSPACE_DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export async function getDbPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }
  const url = workspaceDatabaseUrl();
  if (!url) {
    throw new Error("WORKSPACE_DATABASE_URL is not configured.");
  }
  const pg = await import("pg");
  pool = new pg.Pool({ connectionString: url, max: 5 });
  return pool;
}

export async function withDb<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = await getDbPool();
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export const WORKSPACES_DDL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  schedule_json JSONB NOT NULL DEFAULT '{"discoverHour":8,"applyHour":9}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  spreadsheet_id TEXT NOT NULL,
  jobs_sheet_gid TEXT NOT NULL,
  exclude_companies_sheet_name TEXT NOT NULL DEFAULT 'Exclude Companies',
  discovery_board_urls JSONB NOT NULL DEFAULT '[]',
  monthly_budget_ils INTEGER NOT NULL DEFAULT 500,
  apply_tech_target INTEGER NOT NULL DEFAULT 10,
  apply_marketing_target INTEGER NOT NULL DEFAULT 10,
  notification_target TEXT NOT NULL DEFAULT '',
  run_token_hash TEXT NOT NULL,
  google_refresh_token_enc TEXT,
  mailbox_refresh_token_enc TEXT,
  mailbox_email TEXT,
  greenhouse_otp_webhook_url TEXT,
  browser_user_data_dir TEXT,
  ledger_path TEXT,
  apply_attempts_path TEXT,
  last_discover_run_key TEXT,
  last_apply_run_key TEXT,
  last_outcome_run_key TEXT,
  profile_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orchestration_runs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  run_source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS orchestration_runs_workspace_started ON orchestration_runs(workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS schedule_slot_executions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error_summary TEXT,
  PRIMARY KEY (workspace_id, slot_key)
);
CREATE INDEX IF NOT EXISTS schedule_slot_executions_started ON schedule_slot_executions(started_at DESC);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS mailbox_refresh_token_enc TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS mailbox_email TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS profile_json JSONB;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS last_outcome_run_key TEXT;

CREATE TABLE IF NOT EXISTS email_message_dedupe (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, gmail_message_id)
);

CREATE TABLE IF NOT EXISTS mcp_tool_idempotency (
  idempotency_key TEXT NOT NULL,
  tool TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  submit BOOLEAN NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt_id TEXT,
  response_json JSONB,
  job_dedup_key TEXT,
  submission_stage TEXT,
  owner_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (idempotency_key, tool)
);
CREATE INDEX IF NOT EXISTS mcp_tool_idempotency_workspace_updated ON mcp_tool_idempotency(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tool_idempotency_job_dedup ON mcp_tool_idempotency(workspace_id, job_dedup_key)
  WHERE submit = true AND job_dedup_key IS NOT NULL;

ALTER TABLE mcp_tool_idempotency ADD COLUMN IF NOT EXISTS job_dedup_key TEXT;
ALTER TABLE mcp_tool_idempotency ADD COLUMN IF NOT EXISTS submission_stage TEXT;
ALTER TABLE mcp_tool_idempotency ADD COLUMN IF NOT EXISTS owner_token TEXT;

CREATE TABLE IF NOT EXISTS canonical_job_submit_guard (
  workspace_id TEXT NOT NULL,
  job_dedup_key TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  owner_token TEXT NOT NULL,
  state TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, job_dedup_key)
);
CREATE INDEX IF NOT EXISTS canonical_job_submit_guard_state ON canonical_job_submit_guard(state);
`;

export async function ensureWorkspaceSchema(): Promise<void> {
  const url = workspaceDatabaseUrl();
  if (!url) {
    return;
  }
  try {
    await withDb(async (client) => {
      await client.query(WORKSPACES_DDL);
    });
    log("WORKSPACE_SCHEMA_READY", {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WORKSPACE_SCHEMA_FAILED", { message });
    throw error;
  }
}
