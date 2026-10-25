import { canonicalPostingKey } from "../application/job-posting-identity.js";
import { postingKeyFromSheetRow } from "../orchestration/sheets/sheet-posting-keys.js";
import type { JobSheetRow } from "../orchestration/sheets/job-sheet.js";

export type JobSheetLookupQuery = {
  rowNumber?: number;
  jobUrl?: string;
  canonicalJobId?: string;
};

export function findJobSheetRow(rows: JobSheetRow[], query: JobSheetLookupQuery): JobSheetRow | null {
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
  const canonicalNeedle = query.canonicalJobId?.trim().toLowerCase();
  if (canonicalNeedle) {
    for (const row of rows) {
      const postingKey = postingKeyFromSheetRow(row);
      if (postingKey && postingKey.toLowerCase() === canonicalNeedle) {
        return row;
      }
      const url = String(row["Job URL"] ?? "").trim();
      const fromUrl = url ? canonicalPostingKey(url) : null;
      if (fromUrl && fromUrl.toLowerCase() === canonicalNeedle) {
        return row;
      }
      const explicit = String(row["Unique Key"] ?? "").trim().toLowerCase();
      if (explicit && explicit === canonicalNeedle) {
        return row;
      }
    }
    return null;
  }
  return null;
}
