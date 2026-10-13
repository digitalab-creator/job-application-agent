import { budgetSnapshot } from "../budget/monthly-budget.js";
import { log } from "../logging/logger.js";
import type { ApplyInput } from "./apply-job.js";
import type { ApplicationResult } from "../models/types.js";

export function applyAttemptQuotaEnforced(): boolean {
  const raw = process.env.APPLY_USE_ATTEMPT_QUOTA?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Structured log + richer sheet notes for every non-success outcome (and success for audit). */
export function recordApplyAttemptDebug(input: ApplyInput, outcome: ApplicationResult): void {
  const budget = budgetSnapshot();
  const pipeline = outcome.pipeline;
  log("APPLY_ATTEMPT_FINISHED", {
    row: input.row ?? null,
    company: input.job.company,
    role: input.job.role,
    url: outcome.canonicalJobUrl ?? outcome.jobUrl ?? input.job.url,
    status: outcome.status,
    terminalOutcome: outcome.terminalOutcome ?? null,
    blocker: outcome.blocker ?? null,
    submitted: outcome.submitted,
    confirmationDetected: outcome.confirmationDetected,
    attemptId: outcome.attemptId ?? input.attemptId ?? null,
    llmCostUsd: outcome.llmCostUsd ?? null,
    pipeline: pipeline
      ? {
          opened: pipeline.opened,
          fitPassed: pipeline.fitPassed,
          cvGenerated: pipeline.cvGenerated,
          cvQualityPassed: pipeline.cvQualityPassed,
          submitted: pipeline.submitted,
          confirmed: pipeline.confirmed,
        }
      : null,
    dailyBudgetIls: budget.dailyBudgetIls,
    dailySpentIls: budget.dailySpentIls,
    dailyRemainingIls: budget.dailyRemainingIls,
    monthlyRemainingIls: budget.remainingIls,
    daysRemaining: budget.daysRemaining,
  });

  if (outcome.status === "applied" && outcome.confirmationDetected) {
    return;
  }

  const lines = [
    outcome.notes?.trim() || "",
    `debug_terminal=${outcome.terminalOutcome ?? "n/a"}`,
    `debug_blocker=${outcome.blocker ?? "none"}`,
    pipeline
      ? `debug_pipeline=opened:${pipeline.opened} fit:${pipeline.fitPassed} cv:${pipeline.cvGenerated} cvq:${pipeline.cvQualityPassed} submit:${pipeline.submitted} confirm:${pipeline.confirmed}`
      : "",
    `debug_budget_daily=${budget.dailySpentIls}/${budget.dailyBudgetIls} ILS remaining=${budget.dailyRemainingIls}`,
    `debug_budget_monthly_remaining=${budget.remainingIls} ILS days_left=${budget.daysRemaining}`,
    outcome.llmCostUsd !== undefined ? `debug_attempt_llm_usd=${outcome.llmCostUsd}` : "",
  ].filter(Boolean);
  outcome.notes = lines.join("\n");
}
