import { resolveApplyCapability } from "../application/ats-capability.js";
import { hostIsCooling } from "../application/rate-limit.js";
import { isExcludedApplyCompany } from "../application/exclude-company.js";
import { computeNewQueueStats } from "../discovery/queue-mix.js";
import { isFreelanceOpportunity, opportunityKindFromRow } from "../freelance/opportunity-kind.js";
import { isEligibleApplySheetRow } from "./pick-jobs.js";
import type { JobSheetRow } from "./sheets/job-sheet.js";

export type QueueDepthSnapshot = {
  sheetRows: number;
  statusNew: number;
  eligibleEmployment: number;
  automatableEmployment: number;
  manualOnlyEmployment: number;
  freelanceNew: number;
  cooling: number;
  excludedCompany: number;
  invalidUrl: number;
  mix: ReturnType<typeof computeNewQueueStats>;
};

export function computeQueueDepthSnapshot(
  rows: JobSheetRow[],
  excludedCompanies: string[],
): QueueDepthSnapshot {
  let statusNew = 0;
  let eligibleEmployment = 0;
  let automatableEmployment = 0;
  let manualOnlyEmployment = 0;
  let freelanceNew = 0;
  let cooling = 0;
  let excludedCompany = 0;
  let invalidUrl = 0;

  const employmentNewRows: JobSheetRow[] = [];

  for (const row of rows) {
    const status = String(row.Status ?? "").trim();
    if (status !== "New") {
      continue;
    }
    statusNew += 1;
    if (isFreelanceOpportunity(row)) {
      freelanceNew += 1;
      continue;
    }
    employmentNewRows.push(row);
    const url = String(row["Job URL"] ?? "").trim();
    if (!url) {
      invalidUrl += 1;
      continue;
    }
    if (hostIsCooling(url)) {
      cooling += 1;
      continue;
    }
    if (isExcludedApplyCompany(String(row.Company ?? ""), excludedCompanies)) {
      excludedCompany += 1;
      continue;
    }
    if (!isEligibleApplySheetRow(row)) {
      const cap = resolveApplyCapability(url);
      if (cap === "invalid") {
        invalidUrl += 1;
      } else if (cap === "manual_only") {
        manualOnlyEmployment += 1;
      }
      continue;
    }
    eligibleEmployment += 1;
    const cap = resolveApplyCapability(url);
    if (cap === "supported_auto") {
      automatableEmployment += 1;
    }
  }

  const mix = computeNewQueueStats(
    employmentNewRows.map((row) => ({
      category: String(row.Category ?? ""),
    })),
  );

  return {
    sheetRows: rows.length,
    statusNew,
    eligibleEmployment,
    automatableEmployment,
    manualOnlyEmployment,
    freelanceNew,
    cooling,
    excludedCompany,
    invalidUrl,
    mix: { ...mix, statusNew: employmentNewRows.length },
  };
}

export function rowOpportunityKind(row: JobSheetRow): string {
  return opportunityKindFromRow(row);
}
