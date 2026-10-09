import { log } from "../logging/logger.js";
import { resolveApplyCapability } from "../application/ats-capability.js";
import { executeApply } from "../application/execute-apply.js";
import { newAttemptId } from "../application/attempt-ledger.js";
import { sheetMatchScore } from "../orchestration/pick-jobs.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";
import { updateJobSheetRow } from "../orchestration/sheets/job-sheet.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { runtimeFromWorkspace, withWorkspaceRuntime } from "../orchestration/workspace-runtime.js";
import { buildFreelancePack, formatPackForSheetNotes, persistFreelancePack } from "./build-pack.js";
import { isFreelanceOpportunity, opportunityKindFromRow } from "./opportunity-kind.js";
import { decryptSecret } from "../orchestration/crypto.js";
import { runFreelanceDigest } from "./digest.js";

const DEFAULT_DAILY_FREELANCE_PACKS = 3;

export type FreelanceBatchResult = {
  scanned: number;
  packsReady: number;
  autoApplyAttempted: number;
  autoApplyConfirmed: number;
  digestSent: boolean;
  digestReason?: string;
  notes: string;
};

function dailyFreelanceCap(): number {
  const parsed = Number(process.env.FREELANCE_PACKS_PER_DAY ?? String(DEFAULT_DAILY_FREELANCE_PACKS));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_DAILY_FREELANCE_PACKS;
  }
  return Math.min(10, Math.floor(parsed));
}

export async function processFreelanceBatch(
  workspace: WorkspaceRecord,
  rows: JobSheetRow[],
  dryRun: boolean,
): Promise<FreelanceBatchResult> {
  const cap = dailyFreelanceCap();
  const candidates = rows.filter((row) => {
    const status = String(row.Status ?? "").trim();
    if (status !== "New") {
      return false;
    }
    if (!isFreelanceOpportunity(row)) {
      return false;
    }
    const notes = String(row.Notes ?? "");
    return !notes.includes("FREELANCE_PACK");
  });

  let packsReady = 0;
  let autoApplyAttempted = 0;
  let autoApplyConfirmed = 0;

  const runApply = async (row: JobSheetRow, packUrl: string) => {
    const startedAt = new Date().toISOString();
    const outcome = await withWorkspaceRuntime(
      runtimeFromWorkspace(workspace, "native_schedule"),
      () =>
        executeApply({
          row: row.row_number,
          submit: true,
          workspaceId: workspace.id,
          runSource: "native_schedule",
          startedAt,
          attemptId: newAttemptId(),
          job: {
            role: String(row.Role ?? ""),
            company: String(row.Company ?? ""),
            url: packUrl,
            matchScore: sheetMatchScore(row),
            category: String(row.Category ?? ""),
            estimatedSalary: String(row["Est. Salary Range"] ?? row["Project Budget"] ?? ""),
            opportunityKind: opportunityKindFromRow(row),
          },
        }),
    );
    return outcome;
  };

  for (const row of candidates.slice(0, cap)) {
    const rowNumber = row.row_number;
    const pack = buildFreelancePack(row, rowNumber);
    const url = pack.url;
    const capability = url ? resolveApplyCapability(url) : "invalid";

    if (capability === "supported_auto" && !dryRun && url) {
      autoApplyAttempted += 1;
      try {
        const outcome = await runApply(row, url);
        if (outcome.confirmationDetected || outcome.status === "applied") {
          autoApplyConfirmed += 1;
        }
        log("FREELANCE_AUTO_APPLY_DONE", {
          url,
          company: pack.company,
          status: outcome.status,
          confirmed: outcome.confirmationDetected,
        });
        continue;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("FREELANCE_AUTO_APPLY_FAILED", { url, message });
      }
    }

    if (dryRun) {
      packsReady += 1;
      continue;
    }

    persistFreelancePack(pack);
    packsReady += 1;
    if (rowNumber) {
      await updateJobSheetRow(workspace, rowNumber, {
        Status: "Review",
        Notes: formatPackForSheetNotes(pack),
      });
    }
  }

  const enc = workspace.mailboxRefreshTokenEnc ?? workspace.googleRefreshTokenEnc;
  const digestResult = await runFreelanceDigest({
    refreshToken: enc ? decryptSecret(enc) : undefined,
    mailboxEmail:
      workspace.mailboxEmail
      ?? workspace.notificationTarget
      ?? process.env.FREELANCE_DIGEST_TO?.trim(),
  });

  return {
    scanned: candidates.length,
    packsReady,
    autoApplyAttempted,
    autoApplyConfirmed,
    digestSent: digestResult.sent,
    digestReason: digestResult.reason,
    notes: `freelance_scanned=${candidates.length} packs=${packsReady} auto=${autoApplyAttempted} confirmed=${autoApplyConfirmed} digest=${digestResult.sent ? "sent" : digestResult.reason ?? "preview"}`,
  };
}
