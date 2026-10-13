import { budgetIsOpen, budgetSnapshot } from "../budget/monthly-budget.js";
import { DAILY_APPLY_BATCH_LIMIT } from "../discovery/queue-mix.js";
import {
  DISCOVERY_SKIP_NEW_MULTIPLIER,
  dailyApplyMaxAttempts,
  quotaSnapshot,
  type QuotaSnapshot,
} from "./daily-quota.js";

/** Typical LLM + infra cost per apply attempt (ILS). Used only to size pick batches from remaining daily allowance. */
export function estimatedApplyCostIls(): number {
  const parsed = Number(process.env.ESTIMATED_APPLY_COST_ILS ?? "1");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

/** Hard safety ceiling per pick batch (not a business target). Override via env if needed. */
export function applyPickBatchSafetyCap(): number {
  const parsed = Number(process.env.APPLY_PICK_BATCH_SAFETY_CAP ?? "500");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 500;
  }
  return Math.floor(parsed);
}

/**
 * How many rows to pick in one batch: paced daily allowance ÷ estimated cost per attempt.
 * Actual spend is tracked in the cost ledger; apply stops when `budgetIsOpen()` is false.
 */
export function dailyApplyPickLimit(): number {
  const budget = budgetSnapshot();
  if (!budget.dailyOpen) {
    return 0;
  }
  const fromBudget = Math.floor(budget.dailyRemainingIls / estimatedApplyCostIls());
  return Math.min(applyPickBatchSafetyCap(), Math.max(0, fromBudget));
}

export function applyBudgetAllowsWork(): boolean {
  return budgetIsOpen();
}

export type ApplyPolicySnapshot = QuotaSnapshot & {
  dailyPickLimit: number;
  estimatedApplyCostIls: number;
  dailyBudgetRemainingIls: number;
  dailyOpen: boolean;
};

export function applyPolicySnapshot(): ApplyPolicySnapshot {
  const quota = quotaSnapshot();
  const budget = budgetSnapshot();
  const dailyPickLimit = dailyApplyPickLimit();
  return {
    ...quota,
    maxAttempts: dailyApplyMaxAttempts(),
    discoverySkipThreshold: DISCOVERY_SKIP_NEW_MULTIPLIER * DAILY_APPLY_BATCH_LIMIT,
    dailyPickLimit,
    estimatedApplyCostIls: estimatedApplyCostIls(),
    dailyBudgetRemainingIls: budget.dailyRemainingIls,
    dailyOpen: budget.dailyOpen,
  };
}
