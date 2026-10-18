import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";

export function findJobSheetRow(
  rows: JobSheetRow[],
  query: { rowNumber?: number; jobUrl?: string },
): JobSheetRow | null {
  if (query.rowNumber !== undefined && Number.isFinite(query.rowNumber)) {
    const target = Math.floor(query.rowNumber);
    const byRow = rows.find((row) => Number(row.row_number ?? 0) === target);
    if (byRow) {
      return byRow;
    }
  }
  const urlNeedle = query.jobUrl?.trim().toLowerCase();
  if (urlNeedle) {
    return (
      rows.find((row) => String(row["Job URL"] ?? "").trim().toLowerCase() === urlNeedle) ?? null
    );
  }
  return null;
}
