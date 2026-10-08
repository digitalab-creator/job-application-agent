export type WorkspaceSchedule = {
  /** Local hour (0–23) in workspace timezone. */
  discoverHour: number;
  applyHour: number;
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
  lastDiscoverRunKey: string | null;
  lastApplyRunKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceUpsertInput = Omit<
  WorkspaceRecord,
  "createdAt" | "updatedAt" | "lastDiscoverRunKey" | "lastApplyRunKey"
> & {
  lastDiscoverRunKey?: string | null;
  lastApplyRunKey?: string | null;
};
