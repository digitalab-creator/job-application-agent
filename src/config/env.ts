import fs from "node:fs";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export const env = {
  port: Number(optional("PORT", "3000")),
  applyApiToken: required("APPLY_API_TOKEN"),
  technicalCvPath: required("TECHNICAL_CV_PATH"),
  marketingCvPath: required("MARKETING_CV_PATH"),
  llmBaseUrl: optional("LLM_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
  llmApiKey: required("LLM_API_KEY"),
  llmModel: optional("LLM_MODEL", "gpt-5.6-terra"),
  llmCvModel: optional("LLM_CV_MODEL", "gpt-5.6-sol"),
  generatedCvDir: optional("GENERATED_CV_DIR", "/app/generated-cv"),
  screenshotDir: optional("SCREENSHOT_DIR", "/app/screenshots"),
  auditDir: optional("AUDIT_DIR", "/app/audit"),
  ledgerPath: optional("LEDGER_PATH", "/app/data/ledger/applications.jsonl"),
  navigationTimeoutMs: 30_000,
  actionTimeoutMs: 10_000,
  jobTimeoutMs: 8 * 60_000,
  screenshotRetentionDays: 30,
  browserPersistentProfile: optional("BROWSER_PERSISTENT_PROFILE", "true") === "true",
  browserApplyHeadless: optional("BROWSER_APPLY_HEADLESS", "false") === "true",
  browserUserDataDir: optional("BROWSER_USER_DATA_DIR", "/app/data/browser-profile"),
  browserSlowMoMs: Number(optional("BROWSER_SLOW_MO_MS", "0")),
  browserTimezone: optional("BROWSER_TIMEZONE", "Asia/Jerusalem"),
  discoveryMaxJobsPerBoard: Math.max(1, Math.floor(Number(optional("DISCOVERY_MAX_JOBS_PER_BOARD", "12")))),
  discoveryMaxJobsPerRun: Math.max(1, Math.floor(Number(optional("DISCOVERY_MAX_JOBS_PER_RUN", "20")))),
};

export function cvFileStatus(): { technical: boolean; marketing: boolean } {
  return {
    technical: fileReady(env.technicalCvPath),
    marketing: fileReady(env.marketingCvPath),
  };
}

function fileReady(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 1000;
  } catch {
    return false;
  }
}
