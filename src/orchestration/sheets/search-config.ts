import { parseSearchConfigSheet, type SearchPolicy } from "../../config/search-policy.js";
import { decryptSecret } from "../crypto.js";
import type { WorkspaceRecord } from "../workspace-types.js";
import { readSheetValues } from "./google-sheets.js";

export const SEARCH_CONFIG_SHEET_NAME = "Search Config";

function workspaceRefreshToken(workspace: WorkspaceRecord): string {
  if (!workspace.googleRefreshTokenEnc) {
    throw new Error(`Workspace ${workspace.id} has no Google refresh token.`);
  }
  return decryptSecret(workspace.googleRefreshTokenEnc);
}

export async function loadSearchPolicyFromSheet(workspace: WorkspaceRecord): Promise<SearchPolicy> {
  const refresh = workspaceRefreshToken(workspace);
  const range = `'${SEARCH_CONFIG_SHEET_NAME.replace(/'/g, "''")}'!A:Z`;
  try {
    const values = await readSheetValues(refresh, workspace.spreadsheetId, range);
    return parseSearchConfigSheet(values);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unable to parse range|404|not found/i.test(message)) {
      const { defaultSearchPolicy } = await import("../../config/search-policy.js");
      return defaultSearchPolicy();
    }
    throw error;
  }
}
