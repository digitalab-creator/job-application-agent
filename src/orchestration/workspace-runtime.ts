import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkspaceRecord } from "./workspace-types.js";
import { decryptSecret } from "./crypto.js";

export type ApplyRunSource =
  | "n8n_schedule"
  | "n8n_webhook"
  | "retry_batch"
  | "manual"
  | "native_schedule"
  | "native_manual";

export type WorkspaceRuntime = {
  workspaceId: string;
  runSource: ApplyRunSource;
  runId?: string;
  batchId?: string;
  ledgerPath?: string;
  applyAttemptsPath?: string;
  browserUserDataDir?: string;
  monthlyBudgetIls?: number;
  mailboxEmail?: string;
  mailboxRefreshToken?: string;
  googleRefreshToken?: string;
  greenhouseOtpWebhookUrl?: string | null;
};

const storage = new AsyncLocalStorage<WorkspaceRuntime>();

export function getWorkspaceRuntime(): WorkspaceRuntime | undefined {
  return storage.getStore();
}

export function withWorkspaceRuntime<T>(runtime: WorkspaceRuntime, fn: () => Promise<T>): Promise<T> {
  return storage.run(runtime, fn);
}

export function runtimeFromWorkspace(
  workspace: WorkspaceRecord,
  runSource: ApplyRunSource,
  extras?: Partial<WorkspaceRuntime>,
): WorkspaceRuntime {
  const mailboxEnc = workspace.mailboxRefreshTokenEnc;
  const googleEnc = workspace.googleRefreshTokenEnc;
  return {
    workspaceId: workspace.id,
    runSource,
    ledgerPath: workspace.ledgerPath ?? undefined,
    applyAttemptsPath: workspace.applyAttemptsPath ?? undefined,
    browserUserDataDir: workspace.browserUserDataDir ?? undefined,
    monthlyBudgetIls: workspace.monthlyBudgetIls,
    mailboxEmail: workspace.mailboxEmail ?? undefined,
    mailboxRefreshToken: mailboxEnc ? decryptSecret(mailboxEnc) : undefined,
    googleRefreshToken: googleEnc ? decryptSecret(googleEnc) : undefined,
    greenhouseOtpWebhookUrl: workspace.greenhouseOtpWebhookUrl,
    ...extras,
  };
}

export function resolveLedgerPath(fallback: string): string {
  return getWorkspaceRuntime()?.ledgerPath?.trim() || fallback;
}

export function resolveApplyAttemptsPath(fallback: string): string {
  return getWorkspaceRuntime()?.applyAttemptsPath?.trim() || fallback;
}

export function resolveBrowserUserDataDir(fallback: string): string {
  return getWorkspaceRuntime()?.browserUserDataDir?.trim() || fallback;
}

export function resolveMonthlyBudgetIls(fallback: number): number {
  const fromRuntime = getWorkspaceRuntime()?.monthlyBudgetIls;
  if (typeof fromRuntime === "number" && Number.isFinite(fromRuntime) && fromRuntime >= 1) {
    return Math.round(fromRuntime);
  }
  return fallback;
}
