import { log } from "../../logging/logger.js";
import type { WorkspaceRecord } from "../workspace-types.js";
import { clearBasicFiltersOnSheets, googleAccessTokenFromRefresh } from "./google-sheets.js";
import { decryptSecret } from "../crypto.js";

const clearedAtByKey = new Map<string, number>();
/** Avoid hammering Sheets metadata on hot paths (pick loop reads many times per run). */
const CLEAR_COOLDOWN_MS = 30_000;

function workspaceRefreshToken(workspace: WorkspaceRecord): string {
  if (!workspace.googleRefreshTokenEnc) {
    throw new Error(`Workspace ${workspace.id} has no Google refresh token.`);
  }
  return decryptSecret(workspace.googleRefreshTokenEnc);
}

function parseJobsSheetId(workspace: WorkspaceRecord): number | null {
  const raw = String(workspace.jobsSheetGid ?? "").trim();
  if (!raw) {
    return null;
  }
  const sheetId = Number(raw);
  if (!Number.isFinite(sheetId)) {
    return null;
  }
  return sheetId;
}

/**
 * Google Sheets **basic filters** break Apps Script append/format writes and confuse automation.
 * Filter **views** are fine. Clear only the sheet-level basic filter before worker I/O.
 */
export async function ensureJobsSheetBasicFilterOff(workspace: WorkspaceRecord): Promise<void> {
  const sheetId = parseJobsSheetId(workspace);
  if (sheetId === null) {
    return;
  }
  const cacheKey = `${workspace.spreadsheetId}:${sheetId}`;
  const now = Date.now();
  const last = clearedAtByKey.get(cacheKey) ?? 0;
  if (now - last < CLEAR_COOLDOWN_MS) {
    return;
  }

  const refresh = workspaceRefreshToken(workspace);
  const token = await googleAccessTokenFromRefresh(refresh);
  const cleared = await clearBasicFiltersOnSheets(token, workspace.spreadsheetId, [sheetId]);
  clearedAtByKey.set(cacheKey, now);
  if (cleared.length > 0) {
    log("SHEET_BASIC_FILTER_CLEARED", {
      workspaceId: workspace.id,
      spreadsheetId: workspace.spreadsheetId,
      sheetIds: cleared,
    });
  }
}
