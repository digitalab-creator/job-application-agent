import { extractHttpUrlFromCell, isKnownBlockedApplyUrl, parseHttpUrl } from "../application/automatable-url.js";
import { resolveApplyCapability } from "../application/ats-capability.js";
import { hostIsCooling } from "../application/rate-limit.js";
import { isExcludedApplyCompany } from "../application/exclude-company.js";
import { computeNewQueueStats } from "../discovery/queue-mix.js";
import { isFreelanceOpportunity, opportunityKindFromRow } from "../freelance/opportunity-kind.js";
import { isEligibleApplySheetRow } from "./pick-jobs.js";
import type { JobSheetRow } from "./sheets/job-sheet.js";

const MAX_NEW_ROW_ISSUE_SAMPLES = 20;

export type NewQueueRowIssue = {
  company: string;
  role: string;
  jobUrl: string;
  issue:
    | "missing_url"
    | "invalid_url"
    | "blocked_listing"
    | "manual_only"
    | "host_cooling"
    | "excluded_company";
};

export type QueueDepthSnapshot = {
  sheetRows: number;
  statusNew: number;
  eligibleEmployment: number;
  automatableEmployment: number;
  resolvableEmployment: number;
  actionableEmployment: number;
  manualOnlyEmployment: number;
  freelanceNew: number;
  cooling: number;
  excludedCompany: number;
  invalidUrl: number;
  mix: ReturnType<typeof computeNewQueueStats>;
  /** Sample of `New` employment rows blocked from auto-apply (for daily report). */
  newRowIssues: NewQueueRowIssue[];
};

export function computeQueueDepthSnapshot(
  rows: JobSheetRow[],
  excludedCompanies: string[],
): QueueDepthSnapshot {
  let statusNew = 0;
  let eligibleEmployment = 0;
  let automatableEmployment = 0;
  let resolvableEmployment = 0;
  let manualOnlyEmployment = 0;
  let freelanceNew = 0;
  let cooling = 0;
  let excludedCompany = 0;
  let invalidUrl = 0;

  const employmentNewRows: JobSheetRow[] = [];
  const newRowIssues: NewQueueRowIssue[] = [];

  const pushIssue = (row: JobSheetRow, issue: NewQueueRowIssue["issue"]) => {
    if (newRowIssues.length >= MAX_NEW_ROW_ISSUE_SAMPLES) {
      return;
    }
    const rawUrl = String(row["Job URL"] ?? "").trim();
    newRowIssues.push({
      company: String(row.Company ?? "").trim() || "?",
      role: String(row.Role ?? row["Job Title"] ?? "").trim() || "?",
      jobUrl: rawUrl.slice(0, 240),
      issue,
    });
  };

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
    const url = extractHttpUrlFromCell(String(row["Job URL"] ?? "")) ?? String(row["Job URL"] ?? "").trim();
    if (!url) {
      invalidUrl += 1;
      pushIssue(row, "missing_url");
      continue;
    }
    if (isKnownBlockedApplyUrl(url)) {
      invalidUrl += 1;
      pushIssue(row, "blocked_listing");
      continue;
    }
    if (!parseHttpUrl(url)) {
      invalidUrl += 1;
      pushIssue(row, "invalid_url");
      continue;
    }
    if (hostIsCooling(url)) {
      cooling += 1;
      pushIssue(row, "host_cooling");
      continue;
    }
    if (isExcludedApplyCompany(String(row.Company ?? ""), excludedCompanies)) {
      excludedCompany += 1;
      pushIssue(row, "excluded_company");
      continue;
    }
    if (!isEligibleApplySheetRow(row)) {
      const cap = resolveApplyCapability(url);
      if (cap === "invalid") {
        invalidUrl += 1;
        pushIssue(row, parseHttpUrl(url) ? "blocked_listing" : "invalid_url");
      } else if (cap === "manual_only") {
        manualOnlyEmployment += 1;
        pushIssue(row, "manual_only");
      }
      continue;
    }
    eligibleEmployment += 1;
    const cap = resolveApplyCapability(url);
    if (cap === "supported_auto") {
      automatableEmployment += 1;
    } else if (cap === "resolvable") {
      resolvableEmployment += 1;
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
    resolvableEmployment,
    actionableEmployment: automatableEmployment + resolvableEmployment,
    manualOnlyEmployment,
    freelanceNew,
    cooling,
    excludedCompany,
    invalidUrl,
    mix: { ...mix, statusNew: employmentNewRows.length },
    newRowIssues,
  };
}

export function rowOpportunityKind(row: JobSheetRow): string {
  return opportunityKindFromRow(row);
}
