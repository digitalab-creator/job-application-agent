#!/usr/bin/env node
/**
 * Seed workspace `internal` from operator env (one-time bootstrap).
 * Requires: WORKSPACE_DATABASE_URL, PLATFORM_ENCRYPTION_KEY, GOOGLE_OAUTH_*,
 * WORKSPACE_INTERNAL_RUN_TOKEN, WORKSPACE_INTERNAL_GOOGLE_REFRESH_TOKEN,
 * optional WORKSPACE_INTERNAL_MAILBOX_REFRESH_TOKEN + WORKSPACE_INTERNAL_MAILBOX_EMAIL.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) {
      continue;
    }
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

loadDotEnv(path.join(root, ".env"));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function encryptSecret(plain) {
  const raw = required("PLATFORM_ENCRYPTION_KEY");
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : crypto.createHash("sha256").update(raw, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

const spreadsheetId = required("WORKSPACE_INTERNAL_SPREADSHEET_ID");
const jobsSheetGid = required("WORKSPACE_INTERNAL_JOBS_SHEET_GID");
const boards = (process.env.JOB_DISCOVERY_BOARD_URLS || "")
  .split(/[\n,]+/)
  .map((part) => part.trim())
  .filter((part) => /^https?:\/\//i.test(part));

const refreshToken = process.env.WORKSPACE_INTERNAL_GOOGLE_REFRESH_TOKEN?.trim();
if (!refreshToken) {
  console.error("Set WORKSPACE_INTERNAL_GOOGLE_REFRESH_TOKEN before seeding.");
  process.exit(1);
}
const mailboxRefresh = process.env.WORKSPACE_INTERNAL_MAILBOX_REFRESH_TOKEN?.trim() || null;
const mailboxEmail = mailboxRefresh ? required("WORKSPACE_INTERNAL_MAILBOX_EMAIL") : null;

function loadCandidateProfileJson() {
  const inline = process.env.WORKSPACE_INTERNAL_CANDIDATE_PROFILE_JSON?.trim();
  if (inline) {
    return JSON.parse(inline);
  }
  const profilePath =
    process.env.WORKSPACE_INTERNAL_CANDIDATE_PROFILE_PATH?.trim() ||
    path.join(root, "data/config/internal-candidate-profile.json");
  if (fs.existsSync(profilePath)) {
    return JSON.parse(fs.readFileSync(profilePath, "utf8"));
  }
  return null;
}

const candidateProfile = loadCandidateProfileJson();
if (!candidateProfile) {
  console.error(
    "Set WORKSPACE_INTERNAL_CANDIDATE_PROFILE_JSON or WORKSPACE_INTERNAL_CANDIDATE_PROFILE_PATH (gitignored JSON).",
  );
  process.exit(1);
}

const runToken = required("WORKSPACE_INTERNAL_RUN_TOKEN");
const dbUrl = required("WORKSPACE_DATABASE_URL");

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
await client.query(`
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS mailbox_refresh_token_enc TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS mailbox_email TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS profile_json JSONB;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS last_outcome_run_key TEXT;
`);

await client.query(
  `INSERT INTO workspaces (
    id, display_name, timezone, schedule_json, enabled, spreadsheet_id, jobs_sheet_gid,
    discovery_board_urls, monthly_budget_ils, run_token_hash, google_refresh_token_enc,
    mailbox_refresh_token_enc, mailbox_email,
    greenhouse_otp_webhook_url, browser_user_data_dir, ledger_path, apply_attempts_path,
    profile_json
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
  ON CONFLICT (id) DO UPDATE SET
    spreadsheet_id = EXCLUDED.spreadsheet_id,
    jobs_sheet_gid = EXCLUDED.jobs_sheet_gid,
    discovery_board_urls = EXCLUDED.discovery_board_urls,
    run_token_hash = EXCLUDED.run_token_hash,
    google_refresh_token_enc = EXCLUDED.google_refresh_token_enc,
    mailbox_refresh_token_enc = EXCLUDED.mailbox_refresh_token_enc,
    mailbox_email = EXCLUDED.mailbox_email,
    browser_user_data_dir = EXCLUDED.browser_user_data_dir,
    ledger_path = EXCLUDED.ledger_path,
    apply_attempts_path = EXCLUDED.apply_attempts_path,
    monthly_budget_ils = EXCLUDED.monthly_budget_ils,
    profile_json = EXCLUDED.profile_json,
    updated_at = NOW()`,
  [
    "internal",
    "Operator (internal)",
    "Asia/Jerusalem",
    JSON.stringify({ discoverHour: 8, applyHour: 9 }),
    true,
    spreadsheetId,
    jobsSheetGid,
    JSON.stringify(boards),
    Number(process.env.MONTHLY_BUDGET_ILS || 500),
    hashToken(runToken),
    encryptSecret(refreshToken),
    mailboxRefresh ? encryptSecret(mailboxRefresh) : null,
    mailboxEmail,
    process.env.GREENHOUSE_OTP_WEBHOOK_URL || null,
    process.env.BROWSER_USER_DATA_DIR || "/app/data/browser-profile/internal",
    process.env.LEDGER_PATH || "/app/data/ledger/internal/applications.jsonl",
    process.env.APPLY_ATTEMPTS_PATH || "/app/data/ledger/internal/apply-attempts.jsonl",
    JSON.stringify(candidateProfile),
  ],
);

await client.end();
console.log("Seeded workspace internal (sheets + mailbox tokens).");
