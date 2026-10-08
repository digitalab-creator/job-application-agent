#!/usr/bin/env node
/**
 * One-time backlog cleanup: New rows → keep supported_auto; Manual for aggregators;
 * Closed for invalid. Dry-run by default; pass --apply to write the sheet.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (rel) => pathToFileURL(path.join(root, "dist", rel)).href;

const { getWorkspace } = await import(dist("orchestration/workspace-store.js"));
const { readJobSheetRows, updateJobSheetRows } = await import(dist("orchestration/sheets/job-sheet.js"));
const { resolveApplyCapability } = await import(dist("application/ats-capability.js"));
const { ensureWorkspaceSchema } = await import(dist("orchestration/db.js"));

const apply = process.argv.includes("--apply");

await ensureWorkspaceSchema();
const workspace = await getWorkspace("internal");
if (!workspace) {
  throw new Error("workspace internal not found — seed first");
}

const rows = await readJobSheetRows(workspace);
const news = rows.filter((row) => String(row.Status ?? "").trim() === "New");
const summary = { kept: 0, manual: 0, closed: 0, written: 0 };
const patches = [];

for (const row of news) {
  const url = String(row["Job URL"] ?? "").trim();
  const capability = url.startsWith("http") ? resolveApplyCapability(url) : "invalid";
  let next = null;
  if (capability === "supported_auto") {
    summary.kept += 1;
  } else if (capability === "invalid") {
    next = "Closed";
    summary.closed += 1;
  } else {
    next = "Manual";
    summary.manual += 1;
  }
  if (!next || !row.row_number) {
    continue;
  }
  const noteLine = `AUTO_CLASSIFY capability=${capability} → ${next}`;
  const prevNotes = String(row.Notes ?? "").trim();
  const notes = prevNotes.includes("AUTO_CLASSIFY")
    ? prevNotes
    : [noteLine, prevNotes].filter(Boolean).join("\n");
  console.log(
    JSON.stringify({
      row_number: row.row_number,
      company: row.Company,
      capability,
      from: "New",
      to: next,
      url: url.slice(0, 120),
      write: apply,
    }),
  );
  patches.push({ rowNumber: row.row_number, patch: { Status: next, Notes: notes } });
}

if (apply && patches.length) {
  const cellWrites = await updateJobSheetRows(workspace, patches, 40);
  summary.written = patches.length;
  console.log(JSON.stringify({ cellWrites, rowsPatched: patches.length }));
}

console.log(JSON.stringify({ apply, news: news.length, ...summary }, null, 2));
