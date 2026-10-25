import { shouldSkipApplyForScopeDedup } from "../application/submission-dedup.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";

/** Shared blocker list for MCP apply requests and queue exports. */
export function blockersForMcpApply(row: JobSheetRow, excludedCompanies: string[]): string[] {
  const blockers: string[] = [];
  const url = String(row["Job URL"] ?? "").trim();
  const company = String(row.Company ?? "");
  if (excludedCompanies.some((item) => item.toLowerCase() === company.toLowerCase())) {
    blockers.push("excluded_company");
  }
  const dedup = shouldSkipApplyForScopeDedup(url);
  if (dedup.skip) {
    blockers.push(`dedup:${dedup.reason}`);
  }
  const status = String(row.Status ?? "").trim().toLowerCase();
  if (status === "applied") {
    blockers.push("sheet_status_applied");
  }
  return blockers;
}
