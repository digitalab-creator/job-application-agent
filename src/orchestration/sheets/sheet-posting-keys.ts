import { uniqueKeyForUrl } from "../../application/job-posting-identity.js";
import type { JobSheetRow } from "./job-sheet.js";

/** Statuses that must not receive another discovery append for the same posting key. */
export const REDISCOVERY_BLOCK_STATUSES = new Set([
  "new",
  "manual",
  "review",
  "applied",
  "not relevant",
  "closed",
  "pending manual",
]);

export function postingKeyFromSheetRow(row: JobSheetRow): string | null {
  const url = String(row["Job URL"] ?? "").trim();
  if (url) {
    return uniqueKeyForUrl(url);
  }
  const explicit = String(row["Unique Key"] ?? "").trim();
  return explicit || null;
}

export function postingKeysFromSheetRows(rows: JobSheetRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const status = String(row.Status ?? "").trim().toLowerCase();
    if (!status || !REDISCOVERY_BLOCK_STATUSES.has(status)) {
      continue;
    }
    const key = postingKeyFromSheetRow(row);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

export function filterRowsForSheetAppend<T extends Record<string, string | number>>(
  rows: T[],
  existingKeys: Set<string>,
): T[] {
  const seen = new Set(existingKeys);
  const out: T[] = [];
  for (const row of rows) {
    const url = String(row["Job URL"] ?? "").trim();
    const explicit = String(row["Unique Key"] ?? "").trim();
    const key = url ? uniqueKeyForUrl(url) : explicit;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}
