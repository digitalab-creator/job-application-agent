import { budgetSnapshot } from "../budget/monthly-budget.js";
import { DAILY_APPLY_BATCH_LIMIT } from "../discovery/queue-mix.js";
import {
  DISCOVERY_SKIP_NEW_MULTIPLIER,
  dailyApplyMaxAttempts,
  quotaSnapshot,
  type QuotaSnapshot,
} from "./daily-quota.js";

/** Typical LLM + infra cost per apply attempt (ILS). Tune with real ledger averages. */
export function estimatedApplyCostIls(): number {
  const parsed = Number(process.env.ESTIMATED_APPLY_COST_ILS ?? "1");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

/** How many jobs n8n may pick today: min(batch cap, floor(daily budget remaining / est. cost)). */
export function dailyApplyPickLimit(): number {
  const budget = budgetSnapshot();
  if (!budget.dailyOpen) {
    return 0;
  }
  const fromBudget = Math.floor(budget.dailyRemainingIls / estimatedApplyCostIls());
  return Math.min(DAILY_APPLY_BATCH_LIMIT, Math.max(0, fromBudget));
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
