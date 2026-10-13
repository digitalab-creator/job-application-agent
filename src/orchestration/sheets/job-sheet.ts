import { decryptSecret } from "../crypto.js";
import type { WorkspaceRecord } from "../workspace-types.js";
import {
  appendSheetRows,
  batchUpdateSheet,
  headerRowToObjects,
  readSheetValues,
  type SheetRow,
} from "./google-sheets.js";
import { ensureJobsSheetBasicFilterOff } from "./sheet-filter-guard.js";

const JOBS_RANGE = "A:Z";

export type JobSheetRow = SheetRow & {
  Company?: string;
  Role?: string;
  Category?: string;
  Status?: string;
  "Job URL"?: string;
  "Match Score"?: string | number;
  Notes?: string;
  "Applied Date"?: string;
  "Found Date"?: string;
  "Est. Salary Range"?: string;
  "Opportunity Kind"?: string;
  "Project Budget"?: string;
};

function workspaceRefreshToken(workspace: WorkspaceRecord): string {
  if (!workspace.googleRefreshTokenEnc) {
    throw new Error(`Workspace ${workspace.id} has no Google refresh token.`);
  }
  return decryptSecret(workspace.googleRefreshTokenEnc);
}

export async function readJobSheetRows(workspace: WorkspaceRecord): Promise<JobSheetRow[]> {
  await ensureJobsSheetBasicFilterOff(workspace);
  const refresh = workspaceRefreshToken(workspace);
  const values = await readSheetValues(refresh, workspace.spreadsheetId, JOBS_RANGE);
  if (values.length < 2) {
    return [];
  }
  const [header, ...body] = values;
  return headerRowToObjects(header, body) as JobSheetRow[];
}

export async function readExcludeCompanies(workspace: WorkspaceRecord): Promise<string[]> {
  const refresh = workspaceRefreshToken(workspace);
  const range = `'${workspace.excludeCompaniesSheetName.replace(/'/g, "''")}'!A:B`;
  const values = await readSheetValues(refresh, workspace.spreadsheetId, range);
  if (values.length < 2) {
    return [];
  }
  const out: string[] = [];
  for (const row of values.slice(1)) {
    const company = String(row[0] ?? row[1] ?? "").trim();
    if (company) {
      out.push(company);
    }
  }
  return out;
}

export async function updateJobSheetRow(
  workspace: WorkspaceRecord,
  rowNumber: number,
  patch: Record<string, string>,
): Promise<void> {
  await updateJobSheetRows(workspace, [{ rowNumber, patch }]);
}

/** Batch many row patches into fewer Sheets write requests (quota-friendly). */
export async function updateJobSheetRows(
  workspace: WorkspaceRecord,
  rows: Array<{ rowNumber: number; patch: Record<string, string> }>,
  chunkSize = 40,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  await ensureJobsSheetBasicFilterOff(workspace);
  const refresh = workspaceRefreshToken(workspace);
  const headerValues = await readSheetValues(refresh, workspace.spreadsheetId, "1:1");
  const header = headerValues[0] ?? [];
  const colIndex = new Map<string, number>();
  header.forEach((name, idx) => {
    if (name?.trim()) {
      colIndex.set(name.trim(), idx);
    }
  });
  const updates: Array<{ range: string; values: string[][] }> = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.patch)) {
      const idx = colIndex.get(key);
      if (idx === undefined) {
        continue;
      }
      updates.push({
        range: `${columnLetter(idx)}${row.rowNumber}`,
        values: [[value]],
      });
    }
  }
  if (updates.length === 0) {
    return 0;
  }
  let written = 0;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    await batchUpdateSheet(refresh, workspace.spreadsheetId, chunk);
    written += chunk.length;
    if (i + chunkSize < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
  return written;
}

export async function appendDiscoveredJobs(
  workspace: WorkspaceRecord,
  rows: Array<Record<string, string | number>>,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  await ensureJobsSheetBasicFilterOff(workspace);
  const refresh = workspaceRefreshToken(workspace);
  const headerValues = await readSheetValues(refresh, workspace.spreadsheetId, "1:1");
  const header = headerValues[0] ?? [];
  const keys = header.map((h) => h.trim()).filter(Boolean);
  const matrix = rows.map((row) => keys.map((key) => String(row[key] ?? "")));
  await appendSheetRows(refresh, workspace.spreadsheetId, "A:Z", matrix);
  return rows.length;
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
