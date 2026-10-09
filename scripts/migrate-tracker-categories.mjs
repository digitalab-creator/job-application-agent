#!/usr/bin/env node
/**
 * Rewrite legacy Google Sheet Category values to the 30-day tracker categories.
 * Dry-run by default; pass --apply to write the sheet.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (rel) => pathToFileURL(path.join(root, "dist", rel)).href;

const { getWorkspace } = await import(dist("orchestration/workspace-store.js"));
const { readJobSheetRows, updateJobSheetRows } = await import(dist("orchestration/sheets/job-sheet.js"));
const { ensureWorkspaceSchema } = await import(dist("orchestration/db.js"));
const {
  legacyTrackerCategoryLabels,
  trackerCategoryMigrationTarget,
} = await import(dist("discovery/tracker-categories.js"));

const apply = process.argv.includes("--apply");
const workspaceId = process.argv.find((arg) => arg.startsWith("--workspace="))?.split("=")[1] ?? "internal";

await ensureWorkspaceSchema();
const workspace = await getWorkspace(workspaceId);
if (!workspace) {
  throw new Error(`workspace ${workspaceId} not found — seed first`);
}

const rows = await readJobSheetRows(workspace);
const summary = { scanned: rows.length, legacyLabels: legacyTrackerCategoryLabels(), wouldMigrate: 0, written: 0 };
const patches = [];

for (const row of rows) {
  const from = String(row.Category ?? "").trim();
  const to = trackerCategoryMigrationTarget(from);
  if (!to || !row.row_number) {
    continue;
  }
  summary.wouldMigrate += 1;
  console.log(
    JSON.stringify({
      row_number: row.row_number,
      company: row.Company,
      role: row.Role,
      status: row.Status,
      from,
      to,
      write: apply,
    }),
  );
  patches.push({ rowNumber: row.row_number, patch: { Category: to } });
}

if (apply && patches.length) {
  const cellWrites = await updateJobSheetRows(workspace, patches, 40);
  summary.written = patches.length;
  console.log(JSON.stringify({ cellWrites, rowsPatched: patches.length }));
}

console.log(JSON.stringify({ apply, workspaceId, ...summary }, null, 2));
