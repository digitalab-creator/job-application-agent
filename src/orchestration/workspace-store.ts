import type { PoolClient } from "pg";
import { parseCandidateProfile } from "../config/candidate.js";
import { withDb } from "./db.js";
import type { WorkspaceRecord, WorkspaceSchedule, WorkspaceUpsertInput } from "./workspace-types.js";

function rowToWorkspace(row: Record<string, unknown>): WorkspaceRecord {
  const schedule = (row.schedule_json ?? {}) as WorkspaceSchedule;
  const boards = row.discovery_board_urls;
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    timezone: String(row.timezone),
    schedule: {
      discoverHour: Number(schedule.discoverHour ?? 8),
      applyHour: Number(schedule.applyHour ?? 9),
      outcomeHour: Number(schedule.outcomeHour ?? 18),
    },
    enabled: Boolean(row.enabled),
    spreadsheetId: String(row.spreadsheet_id),
    jobsSheetGid: String(row.jobs_sheet_gid),
    excludeCompaniesSheetName: String(row.exclude_companies_sheet_name ?? "Exclude Companies"),
    discoveryBoardUrls: Array.isArray(boards) ? boards.map(String) : [],
    monthlyBudgetIls: Number(row.monthly_budget_ils ?? 500),
    applyTechTarget: Number(row.apply_tech_target ?? 10),
    applyMarketingTarget: Number(row.apply_marketing_target ?? 10),
    notificationTarget: String(row.notification_target ?? ""),
    runTokenHash: String(row.run_token_hash),
    googleRefreshTokenEnc: row.google_refresh_token_enc ? String(row.google_refresh_token_enc) : null,
    mailboxRefreshTokenEnc: row.mailbox_refresh_token_enc ? String(row.mailbox_refresh_token_enc) : null,
    mailboxEmail: row.mailbox_email ? String(row.mailbox_email) : null,
    greenhouseOtpWebhookUrl: row.greenhouse_otp_webhook_url ? String(row.greenhouse_otp_webhook_url) : null,
    browserUserDataDir: row.browser_user_data_dir ? String(row.browser_user_data_dir) : null,
    ledgerPath: row.ledger_path ? String(row.ledger_path) : null,
    applyAttemptsPath: row.apply_attempts_path ? String(row.apply_attempts_path) : null,
    profile: parseCandidateProfile(row.profile_json),
    lastDiscoverRunKey: row.last_discover_run_key ? String(row.last_discover_run_key) : null,
    lastApplyRunKey: row.last_apply_run_key ? String(row.last_apply_run_key) : null,
    lastOutcomeRunKey: row.last_outcome_run_key ? String(row.last_outcome_run_key) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function getWorkspace(id: string): Promise<WorkspaceRecord | null> {
  return withDb(async (client) => {
    const res = await client.query("SELECT * FROM workspaces WHERE id = $1", [id]);
    if (res.rowCount === 0) {
      return null;
    }
    return rowToWorkspace(res.rows[0] as Record<string, unknown>);
  });
}

export async function listEnabledWorkspaces(): Promise<WorkspaceRecord[]> {
  return withDb(async (client) => {
    const res = await client.query("SELECT * FROM workspaces WHERE enabled = true ORDER BY id");
    return res.rows.map((row: Record<string, unknown>) => rowToWorkspace(row));
  });
}

export async function upsertWorkspace(input: WorkspaceUpsertInput): Promise<WorkspaceRecord> {
  return withDb(async (client) => {
    const res = await client.query(
      `INSERT INTO workspaces (
        id, display_name, timezone, schedule_json, enabled, spreadsheet_id, jobs_sheet_gid,
        exclude_companies_sheet_name, discovery_board_urls, monthly_budget_ils,
        apply_tech_target, apply_marketing_target, notification_target, run_token_hash,
        google_refresh_token_enc, mailbox_refresh_token_enc, mailbox_email,
        greenhouse_otp_webhook_url, browser_user_data_dir,
        ledger_path, apply_attempts_path, profile_json, last_discover_run_key, last_apply_run_key,
        last_outcome_run_key
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      )
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        timezone = EXCLUDED.timezone,
        schedule_json = EXCLUDED.schedule_json,
        enabled = EXCLUDED.enabled,
        spreadsheet_id = EXCLUDED.spreadsheet_id,
        jobs_sheet_gid = EXCLUDED.jobs_sheet_gid,
        exclude_companies_sheet_name = EXCLUDED.exclude_companies_sheet_name,
        discovery_board_urls = EXCLUDED.discovery_board_urls,
        monthly_budget_ils = EXCLUDED.monthly_budget_ils,
        apply_tech_target = EXCLUDED.apply_tech_target,
        apply_marketing_target = EXCLUDED.apply_marketing_target,
        notification_target = EXCLUDED.notification_target,
        run_token_hash = EXCLUDED.run_token_hash,
        google_refresh_token_enc = EXCLUDED.google_refresh_token_enc,
        mailbox_refresh_token_enc = EXCLUDED.mailbox_refresh_token_enc,
        mailbox_email = EXCLUDED.mailbox_email,
        greenhouse_otp_webhook_url = EXCLUDED.greenhouse_otp_webhook_url,
        browser_user_data_dir = EXCLUDED.browser_user_data_dir,
        ledger_path = EXCLUDED.ledger_path,
        apply_attempts_path = EXCLUDED.apply_attempts_path,
        profile_json = EXCLUDED.profile_json,
        last_discover_run_key = EXCLUDED.last_discover_run_key,
        last_apply_run_key = EXCLUDED.last_apply_run_key,
        last_outcome_run_key = EXCLUDED.last_outcome_run_key,
        updated_at = NOW()
      RETURNING *`,
      [
        input.id,
        input.displayName,
        input.timezone,
        JSON.stringify(input.schedule),
        input.enabled,
        input.spreadsheetId,
        input.jobsSheetGid,
        input.excludeCompaniesSheetName,
        JSON.stringify(input.discoveryBoardUrls),
        input.monthlyBudgetIls,
        input.applyTechTarget,
        input.applyMarketingTarget,
        input.notificationTarget,
        input.runTokenHash,
        input.googleRefreshTokenEnc,
        input.mailboxRefreshTokenEnc,
        input.mailboxEmail,
        input.greenhouseOtpWebhookUrl,
        input.browserUserDataDir,
        input.ledgerPath,
        input.applyAttemptsPath,
        input.profile ? JSON.stringify(input.profile) : null,
        input.lastDiscoverRunKey ?? null,
        input.lastApplyRunKey ?? null,
        input.lastOutcomeRunKey ?? null,
      ],
    );
    return rowToWorkspace(res.rows[0] as Record<string, unknown>);
  });
}

export async function markWorkspaceRunKey(
  workspaceId: string,
  kind: "discover" | "apply" | "outcome",
  runKey: string,
): Promise<void> {
  const column = kind === "discover"
    ? "last_discover_run_key"
    : kind === "outcome"
      ? "last_outcome_run_key"
      : "last_apply_run_key";
  await withDb(async (client) => {
    await client.query(`UPDATE workspaces SET ${column} = $2, updated_at = NOW() WHERE id = $1`, [
      workspaceId,
      runKey,
    ]);
  });
}

export async function getLatestOrchestrationRun(
  workspaceId: string,
  kind: string,
): Promise<{
  kind: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
} | null> {
  return withDb(async (client) => {
    const res = await client.query(
      `SELECT kind, status, started_at, finished_at, summary_json
       FROM orchestration_runs
       WHERE workspace_id = $1 AND kind = $2
       ORDER BY started_at DESC
       LIMIT 1`,
      [workspaceId, kind],
    );
    if ((res.rowCount ?? 0) === 0) {
      return null;
    }
    const row = res.rows[0] as Record<string, unknown>;
    return {
      kind: String(row.kind),
      status: String(row.status),
      startedAt: new Date(String(row.started_at)).toISOString(),
      finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
      summary: (row.summary_json ?? {}) as Record<string, unknown>,
    };
  });
}

export async function insertOrchestrationRun(
  client: PoolClient,
  row: {
    workspaceId: string;
    kind: string;
    runSource: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    summary: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO orchestration_runs (workspace_id, kind, run_source, started_at, finished_at, status, summary_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      row.workspaceId,
      row.kind,
      row.runSource,
      row.startedAt,
      row.finishedAt,
      row.status,
      JSON.stringify(row.summary),
    ],
  );
}
