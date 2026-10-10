import type { JobSheetRow } from "./sheets/job-sheet.js";

const UNRESOLVED_STATUSES = new Set(["Review", "Manual"]);

export function countUnresolvedSheetRows(rows: JobSheetRow[]): number {
  let count = 0;
  for (const row of rows) {
    const status = String(row.Status ?? "").trim();
    if (UNRESOLVED_STATUSES.has(status)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Historical Review/Manual rows must not starve discovery when actionable New supply is empty.
 * Only pause discovery when backlog is high AND we still have enough automatable New jobs to work.
 */
export function shouldSkipDiscoveryForUnresolvedBacklog(input: {
  unresolvedReviewManual: number;
  actionableAutomatable: number;
  threshold: number;
  minActionableToPauseDiscovery: number;
}): boolean {
  const { unresolvedReviewManual, actionableAutomatable, threshold, minActionableToPauseDiscovery } = input;
  if (threshold <= 0) {
    return false;
  }
  if (unresolvedReviewManual < threshold) {
    return false;
  }
  return actionableAutomatable >= minActionableToPauseDiscovery;
}
