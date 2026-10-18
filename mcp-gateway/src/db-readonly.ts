import type { Pool } from "pg";
import { gatewayConfig } from "./config.js";

const STATEMENT_TIMEOUT_MS = 5_000;

const QUERIES = {
  health: "SELECT 1 AS ok",
  recentRuns: `
    SELECT id, workspace_id, kind, run_source, started_at, finished_at, status
    FROM orchestration_runs
    WHERE workspace_id = $1
    ORDER BY started_at DESC
    LIMIT $2`,
  scheduleSlots: `
    SELECT workspace_id, slot_key, status, owner_id, started_at, finished_at, error_summary
    FROM schedule_slot_executions
    WHERE workspace_id = $1
    ORDER BY started_at DESC
    LIMIT $2`,
  failureSummary: `
    SELECT status, COUNT(*)::int AS count
    FROM orchestration_runs
    WHERE workspace_id = $1 AND started_at > NOW() - INTERVAL '14 days'
    GROUP BY status
    ORDER BY count DESC
    LIMIT 20`,
  workspaceStatus: `
    SELECT id, display_name, timezone, enabled, spreadsheet_id, jobs_sheet_gid,
           monthly_budget_ils, last_discover_run_key, last_apply_run_key, last_outcome_run_key,
           updated_at
    FROM workspaces
    WHERE id = $1`,
} as const;

let pool: Pool | null = null;

async function getPool(): Promise<Pool | null> {
  const url = gatewayConfig.readOnlyDatabaseUrl;
  if (!url) {
    return null;
  }
  if (!pool) {
    const pg = await import("pg");
    pool = new pg.Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

export async function runReadonlyQuery(
  name: keyof typeof QUERIES,
  params: unknown[],
  rowLimit: number,
): Promise<Record<string, unknown>> {
  const p = await getPool();
  if (!p) {
    return { configured: false, rows: [] };
  }
  const client = await p.connect();
  try {
    await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query("SET default_transaction_read_only = on");
    const sql = QUERIES[name];
    const res = await client.query(sql, params);
    const rows = res.rows.slice(0, rowLimit) as Record<string, unknown>[];
    return { configured: true, rows: redactWorkspaceRows(rows) };
  } finally {
    client.release();
  }
}

function redactWorkspaceRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const copy = { ...row };
    for (const key of Object.keys(copy)) {
      if (/token|secret|password|refresh|enc|profile_json/i.test(key)) {
        copy[key] = "[redacted]";
      }
    }
    return copy;
  });
}
