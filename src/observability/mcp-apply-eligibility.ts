import { budgetIsOpen } from "../budget/monthly-budget.js";
import { applyAttemptQuotaEnforced } from "../application/apply-attempt-debug.js";
import { quotaIsOpen } from "../application/daily-quota.js";
import { isEligibleApplySheetRow } from "../orchestration/pick-jobs.js";
import { readExcludeCompanies } from "../orchestration/sheets/job-sheet.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";
import type { WorkspaceRecord } from "../orchestration/workspace-types.js";
import { blockersForMcpApply } from "./mcp-apply-eligibility-blockers.js";

export type McpApplyEligibilityResult =
  | { ok: true }
  | { ok: false; error: string; blockers: string[] };

export async function assessMcpApplyEligibility(
  workspace: WorkspaceRecord,
  row: JobSheetRow,
): Promise<McpApplyEligibilityResult> {
  const excluded = await readExcludeCompanies(workspace);
  const blockers = blockersForMcpApply(row, excluded);
  if (blockers.length > 0) {
    return { ok: false, error: "job_not_eligible", blockers };
  }
  if (!isEligibleApplySheetRow(row)) {
    return { ok: false, error: "job_not_eligible", blockers: ["not_eligible_for_auto_apply"] };
  }
  if (!budgetIsOpen()) {
    return { ok: false, error: "budget_exhausted", blockers: ["daily_or_monthly_budget_closed"] };
  }
  if (applyAttemptQuotaEnforced() && !quotaIsOpen()) {
    return { ok: false, error: "daily_quota_reached", blockers: ["daily_apply_quota_reached"] };
  }
  return { ok: true };
}
