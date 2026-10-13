import { extractHttpUrlFromCell } from "../application/automatable-url.js";
import { resolveApplyCapability } from "../application/ats-capability.js";
import { hostIsCooling } from "../application/rate-limit.js";
import { isExcludedApplyCompany } from "../application/exclude-company.js";
import { dailyApplyPickLimit } from "../application/apply-policy.js";
import { selectApplyDailyBatch } from "../discovery/queue-mix.js";
import { isFreelanceOpportunity } from "../freelance/opportunity-kind.js";
import type { JobSheetRow } from "./sheets/job-sheet.js";
import { shouldSkipApplyForScopeDedup } from "../application/submission-dedup.js";

export function sheetMatchScore(row: JobSheetRow): number {
  const raw = String(row["Match Score"] ?? "").replace(/[^\d.]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function isEligibleApplySheetRow(row: JobSheetRow): boolean {
  if (isFreelanceOpportunity(row)) {
    return false;
  }
  const status = String(row.Status ?? "").trim();
  const retryUpload = status === "Review" && String(row.Notes ?? "").includes("cv_upload_failed");
  if (status !== "New" && !retryUpload) {
    return false;
  }
  const url = extractHttpUrlFromCell(String(row["Job URL"] ?? "")) ?? String(row["Job URL"] ?? "").trim();
  if (hostIsCooling(url)) {
    return false;
  }
  const capability = resolveApplyCapability(url);
  return capability === "supported_auto" || capability === "resolvable";
}

export function filterEligibleApplyRows(
  rows: JobSheetRow[],
  excludedCompanies: string[],
): JobSheetRow[] {
  const seenUrl = new Set<string>();
  const eligible: JobSheetRow[] = [];
  for (const row of rows) {
    if (!isEligibleApplySheetRow(row)) {
      continue;
    }
    const company = String(row.Company ?? "");
    if (isExcludedApplyCompany(company, excludedCompanies)) {
      continue;
    }
    const url = String(row["Job URL"] ?? "").trim();
    if (seenUrl.has(url)) {
      continue;
    }
    const scopeSkip = shouldSkipApplyForScopeDedup(url);
    if (scopeSkip.skip) {
      continue;
    }
    seenUrl.add(url);
    eligible.push(row);
  }
  return eligible;
}

/** Worker-owned daily pick — eligibility here, mix in selectApplyDailyBatch (SSOT). */
export function pickWorkspaceApplyBatch(
  rows: JobSheetRow[],
  excludedCompanies: string[],
  pickLimit?: number,
): { selected: JobSheetRow[]; pickedTech: number; pickedMarketing: number; eligible: number } {
  const rawEligible = filterEligibleApplyRows(rows, excludedCompanies);
  const aggregatorSlots = Math.max(0, Number(process.env.AGGREGATOR_ATTEMPT_SLOTS ?? "5") || 5);
  const autoRows: JobSheetRow[] = [];
  const aggregatorRows: JobSheetRow[] = [];
  for (const row of rawEligible) {
    const capability = resolveApplyCapability(String(row["Job URL"] ?? ""));
    if (capability === "supported_auto") {
      autoRows.push(row);
    } else if (aggregatorRows.length < aggregatorSlots) {
      aggregatorRows.push(row);
    }
  }
  const eligible = [...autoRows, ...aggregatorRows];
  const cap = Math.max(0, pickLimit ?? dailyApplyPickLimit());
  if (cap === 0 || eligible.length === 0) {
    return { selected: [], pickedTech: 0, pickedMarketing: 0, eligible: eligible.length };
  }
  const sorted = [...eligible].sort(
    (a, b) =>
      sheetMatchScore(b) - sheetMatchScore(a)
      || String(b["Found Date"] ?? "").localeCompare(String(a["Found Date"] ?? "")),
  );
  const withCategory = sorted.map((row) => ({
    row,
    category: String(row.Category ?? ""),
  }));
  const { selected, pickedTech, pickedMarketing } = selectApplyDailyBatch(
    withCategory,
    (item) => sheetMatchScore(item.row),
    cap,
  );
  return {
    selected: selected.map((item) => item.row).slice(0, cap),
    pickedTech,
    pickedMarketing,
    eligible: eligible.length,
  };
}
