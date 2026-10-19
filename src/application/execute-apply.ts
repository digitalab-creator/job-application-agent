import { applyToJob, type ApplyInput } from "./apply-job.js";
import { attemptRecordFromResult, rememberAttemptOutcome, rememberAttemptStarted } from "./attempt-ledger.js";
import { budgetIsOpen, budgetSnapshot } from "../budget/monthly-budget.js";
import { quotaIsOpen, quotaSnapshot, rememberQuotaUse } from "./daily-quota.js";
import { applyAttemptQuotaEnforced, recordApplyAttemptDebug } from "./apply-attempt-debug.js";
import { withJobCost } from "../llm/cost-ledger.js";
import { log, withLogContext } from "../logging/logger.js";
import type { ApplicationResult } from "../models/types.js";
import { withApplySession } from "../browser/session.js";
import { recordPlatformAllocationIfNeeded } from "../budget/monthly-budget.js";
import { buildSheetManualNotes, shouldPromoteToManualSheet } from "./manual-fill-guide.js";
import { env } from "../config/env.js";
import { isLinkedInHost, linkedinEasyApplyEnabled, linkedinFeatureDisabledResult } from "./linkedin-easy-apply.js";
import { syncApplyOutcomeToJobSheet } from "../orchestration/sync-apply-outcome-to-sheet.js";
import {
  claimCanonicalJobSubmitGuard,
  markCanonicalJobSubmitGuard,
} from "../observability/canonical-job-submit-guard.js";
import { randomUUID } from "node:crypto";

export async function executeApply(input: ApplyInput): Promise<ApplicationResult> {
  const mcpPreview = input.mcpDryRun === true || input.submit === false;
  const canonicalGuardToken = input.submit && input.workspaceId && input.attemptId
    ? (input.canonicalSubmitGuardOwnerToken ?? randomUUID())
    : null;
  if (canonicalGuardToken && input.workspaceId && input.attemptId) {
    const guard = await claimCanonicalJobSubmitGuard({
      workspaceId: input.workspaceId,
      jobUrl: input.job.url,
      attemptId: input.attemptId,
      ownerToken: canonicalGuardToken,
      idempotencyKey: input.runId,
    });
    if (!guard.ok) {
      const outcome: ApplicationResult = {
        attemptId: input.attemptId,
        status: "already_submitted",
        jobUrl: input.job.url,
        submitted: false,
        confirmationDetected: false,
        terminalOutcome: "already_submitted",
        pipeline: emptyPipeline(),
        blocker: guard.reason,
        notes: `result=already_submitted\nblocker=${guard.reason}`,
      };
      recordApplyAttemptDebug(input, outcome);
      rememberAttempt(input, outcome);
      return finishApply(input, outcome);
    }
  }
  recordPlatformAllocationIfNeeded();
  if (input.attemptId && !mcpPreview) {
    rememberAttemptStarted(
    attemptRecordFromResult(
      {
        attemptId: input.attemptId,
        startedAt: input.startedAt ?? new Date().toISOString(),
        company: input.job.company,
        role: input.job.role,
        url: input.job.url,
        workspaceId: input.workspaceId,
        runSource: input.runSource,
        runId: input.runId,
        batchId: input.batchId,
        triggeredAt: input.triggeredAt,
      },
      {
        status: "review",
        jobUrl: input.job.url,
        submitted: false,
        confirmationDetected: false,
        terminalOutcome: "in_progress",
        pipeline: input.pipeline ?? emptyPipeline(),
        notes: "stage=started",
      },
      input.startedAt ?? new Date().toISOString(),
    ),
  );
  }
  if (!budgetIsOpen()) {
    const budget = budgetSnapshot();
    const outcome: ApplicationResult = {
      attemptId: input.attemptId,
      status: "budget_reached",
      jobUrl: input.job.url,
      submitted: false,
      confirmationDetected: false,
      terminalOutcome: "budget_reached",
      pipeline: emptyPipeline(),
      llmCostUsd: 0,
      budget: compactBudget(budget),
      notes: "result=budget_reached",
    };
    recordApplyAttemptDebug(input, outcome);
    if (!mcpPreview) {
      rememberAttempt(input, outcome);
    }
    return finishApply(input, outcome);
  }
  if (!mcpPreview && applyAttemptQuotaEnforced() && !quotaIsOpen()) {
    const quota = quotaSnapshot();
    const outcome: ApplicationResult = {
      attemptId: input.attemptId,
      status: "quota_reached",
      jobUrl: input.job.url,
      submitted: false,
      confirmationDetected: false,
      terminalOutcome: "quota_reached",
      pipeline: emptyPipeline(),
      llmCostUsd: 0,
      quota,
      notes: "result=quota_reached",
    };
    recordApplyAttemptDebug(input, outcome);
    if (!mcpPreview) {
      rememberAttempt(input, outcome);
    }
    return finishApply(input, outcome);
  }
  if (isLinkedInHost(input.job.url) && !linkedinEasyApplyEnabled()) {
    log("LINKEDIN_EASY_APPLY_DISABLED", { url: input.job.url });
    const outcome = linkedinFeatureDisabledResult(input.job.url);
    outcome.attemptId = input.attemptId;
    outcome.pipeline = input.pipeline ?? emptyPipeline();
    recordApplyAttemptDebug(input, outcome);
    if (!mcpPreview) {
      rememberAttempt(input, outcome);
    }
    return finishApply(input, outcome);
  }
  try {
    const tracked = await withJobCost(
      input.job.url,
      () =>
        withLogContext({ attemptId: input.attemptId! }, () =>
          withApplySession((context) => applyToJob(context, input)),
        ),
    );
    if (!mcpPreview) {
      rememberQuotaUse({
        url: input.job.url,
        status: tracked.result.status,
        submissionScope: tracked.result.submissionScope,
      });
    }
    const outcome = tracked.result;
    attachManualFillGuide(outcome);
    outcome.llmCostUsd = tracked.usd;
    outcome.quota = quotaSnapshot();
    outcome.budget = compactBudget(budgetSnapshot());
    outcome.notes = [outcome.notes, `llm_cost_usd=${tracked.usd}`].filter(Boolean).join("\n");
    recordApplyAttemptDebug(input, outcome);
    if (!mcpPreview) {
      rememberAttempt(input, outcome);
    }
    if (canonicalGuardToken && input.workspaceId && input.attemptId) {
      const guardState = outcome.confirmationDetected || outcome.status === "applied"
        ? "CONFIRMED"
        : uncertainSubmitOutcome(outcome)
          ? "UNCERTAIN"
          : "RELEASED";
      await markCanonicalJobSubmitGuard(input.workspaceId, input.job.url, input.attemptId, canonicalGuardToken, guardState);
    }
    return finishApply(input, outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    log("APPLY_EXECUTE_FAILED", { message });
    const pipeline = input.pipeline ?? emptyPipeline();
    const outcome: ApplicationResult = {
      attemptId: input.attemptId,
      status: "review",
      jobUrl: input.job.url,
      submitted: pipeline.submitted ?? false,
      confirmationDetected: pipeline.confirmed ?? false,
      terminalOutcome: pipeline.confirmed ? "applied" : "request_failed",
      pipeline,
      blocker: "navigation_failed",
      notes: ["result=review", "blocker=navigation_failed", message.split("\n", 1)[0]].join("\n"),
    };
    if (!mcpPreview) {
      rememberQuotaUse({ url: input.job.url, status: outcome.status });
    }
    recordApplyAttemptDebug(input, outcome);
    if (!mcpPreview) {
      rememberAttempt(input, outcome);
    }
    if (canonicalGuardToken && input.workspaceId && input.attemptId) {
      await markCanonicalJobSubmitGuard(
        input.workspaceId,
        input.job.url,
        input.attemptId,
        canonicalGuardToken,
        outcome.submitted ? "UNCERTAIN" : "RELEASED",
      );
    }
    return finishApply(input, outcome);
  }
}

function uncertainSubmitOutcome(outcome: ApplicationResult): boolean {
  if (outcome.pipeline?.submitted && !outcome.confirmationDetected) {
    return true;
  }
  return outcome.blocker === "submitted_unconfirmed";
}

async function finishApply(input: ApplyInput, outcome: ApplicationResult): Promise<ApplicationResult> {
  try {
    await syncApplyOutcomeToJobSheet(input, outcome);
  } catch (error) {
    log("SHEET_SYNC_UNEXPECTED", {
      row: input.row ?? null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return outcome;
}

function attachManualFillGuide(outcome: ApplicationResult): void {
  if (shouldPromoteToManualSheet(outcome) && outcome.status === "review") {
    outcome.status = "manual_required";
  }
  const needsPack = outcome.status === "manual_required" || shouldPromoteToManualSheet(outcome);
  if (!needsPack) {
    return;
  }
  const cvRel = outcome.cvPath?.includes(env.generatedCvDir)
    ? outcome.cvPath.replace(`${env.generatedCvDir}/`, "")
    : outcome.cvPath?.replace(/^\/app\/generated-cv\//, "");
  const cvDownloadUrl = cvRel
    ? (env.applyPublicBaseUrl
      ? `${env.applyPublicBaseUrl}/generated-cv/${cvRel}`
      : `http://127.0.0.1:3099/generated-cv/${cvRel}`)
    : undefined;
  const pack = buildSheetManualNotes({
    applyUrl: outcome.canonicalJobUrl ?? outcome.jobUrl,
    blocker: outcome.blocker,
    cvPath: outcome.cvPath,
    cvDownloadUrl,
    answers: outcome.answers,
  });
  outcome.manualFillGuide = pack;
  const baseNotes = (outcome.notes || "").split("\n\nMANUAL_FILL")[0]?.trim() ?? outcome.notes;
  outcome.notes = [baseNotes, pack].filter(Boolean).join("\n\n");
}

function rememberAttempt(input: ApplyInput, outcome: ApplicationResult): void {
  if (!input.attemptId || !input.startedAt) {
    return;
  }
  try {
    rememberAttemptOutcome(
      attemptRecordFromResult(
        {
          attemptId: input.attemptId,
          startedAt: input.startedAt,
          company: input.job.company,
          role: input.job.role,
          url: input.job.url,
          workspaceId: input.workspaceId,
          runSource: input.runSource,
          runId: input.runId,
          batchId: input.batchId,
          triggeredAt: input.triggeredAt,
        },
        outcome,
      ),
    );
  } catch (error) {
    log("ATTEMPT_LEDGER_WRITE_FAILED", {
      attemptId: input.attemptId,
      message: error instanceof Error ? error.message : "attempt_ledger_write_failed",
    });
  }
}

function emptyPipeline(): NonNullable<ApplicationResult["pipeline"]> {
  return {
    urlValidated: false,
    opened: false,
    recovered: false,
    fitPassed: false,
    cvGenerated: false,
    cvQualityPassed: false,
    submitted: false,
    confirmed: false,
  };
}

function compactBudget(budget: ReturnType<typeof budgetSnapshot>): ApplicationResult["budget"] {
  return {
    day: budget.day,
    month: budget.month,
    limitIls: budget.limitIls,
    spentIls: budget.spentIls,
    remainingIls: budget.remainingIls,
    daysRemaining: budget.daysRemaining,
    dailyBudgetIls: budget.dailyBudgetIls,
    dailySpentIls: budget.dailySpentIls,
    dailyRemainingIls: budget.dailyRemainingIls,
    monthlyOpen: budget.monthlyOpen,
    dailyOpen: budget.dailyOpen,
    open: budget.open,
  };
}
