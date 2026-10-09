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
