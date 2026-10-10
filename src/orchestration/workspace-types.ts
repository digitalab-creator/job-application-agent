import type { CandidateProfile } from "../config/candidate.js";

export type WorkspaceSchedule = {
  /** Local hour (0–23) in workspace timezone. */
  discoverHour: number;
  applyHour: number;
  /** Local hour for the mailbox outcome scan. */
  outcomeHour: number;
};

export type WorkspaceRecord = {
  id: string;
  displayName: string;
  timezone: string;
  schedule: WorkspaceSchedule;
  enabled: boolean;
  spreadsheetId: string;
  /** Google Sheet gid for the jobs tab. */
  jobsSheetGid: string;
  excludeCompaniesSheetName: string;
  discoveryBoardUrls: string[];
  monthlyBudgetIls: number;
  applyTechTarget: number;
  applyMarketingTarget: number;
  notificationTarget: string;
  /** SHA-256 hex of workspace run API token. */
  runTokenHash: string;
  /** Encrypted Google Sheets refresh token. */
  googleRefreshTokenEnc: string | null;
  /** Encrypted Gmail refresh token for OTP / outcome scans. */
  mailboxRefreshTokenEnc: string | null;
  mailboxEmail: string | null;
  greenhouseOtpWebhookUrl: string | null;
  browserUserDataDir: string | null;
  ledgerPath: string | null;
  applyAttemptsPath: string | null;
  /** Buyer identity. Null until seeded. Workspace `internal` falls back to the code seed. */
  profile: CandidateProfile | null;
  lastDiscoverRunKey: string | null;
  lastApplyRunKey: string | null;
  lastOutcomeRunKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceUpsertInput = Omit<
  WorkspaceRecord,
  "createdAt" | "updatedAt" | "lastDiscoverRunKey" | "lastApplyRunKey" | "lastOutcomeRunKey"
> & {
  lastDiscoverRunKey?: string | null;
  lastApplyRunKey?: string | null;
  lastOutcomeRunKey?: string | null;
};
