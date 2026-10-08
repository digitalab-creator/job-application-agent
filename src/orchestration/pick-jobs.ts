import { isAutomatableCapability, resolveApplyCapability } from "../application/ats-capability.js";
import { isExcludedApplyCompany } from "../application/exclude-company.js";
import { dailyApplyPickLimit } from "../application/apply-policy.js";
import { DAILY_APPLY_BATCH_LIMIT, selectApplyDailyBatch } from "../discovery/queue-mix.js";
import type { JobSheetRow } from "./sheets/job-sheet.js";

export function sheetMatchScore(row: JobSheetRow): number {
  const raw = String(row["Match Score"] ?? "").replace(/[^\d.]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function isEligibleApplySheetRow(row: JobSheetRow): boolean {
  const status = String(row.Status ?? "").trim();
  const retryUpload = status === "Review" && String(row.Notes ?? "").includes("cv_upload_failed");
  if (status !== "New" && !retryUpload) {
    return false;
  }
  const url = String(row["Job URL"] ?? "").trim();
  return isAutomatableCapability(resolveApplyCapability(url));
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
  const eligible = filterEligibleApplyRows(rows, excludedCompanies);
  const cap = Math.min(
    DAILY_APPLY_BATCH_LIMIT,
    Math.max(0, pickLimit ?? dailyApplyPickLimit()),
  );
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
  );
  return {
    selected: selected.map((item) => item.row).slice(0, cap),
    pickedTech,
    pickedMarketing,
    eligible: eligible.length,
  };
}
