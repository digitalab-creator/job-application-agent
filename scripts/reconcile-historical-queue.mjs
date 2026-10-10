#!/usr/bin/env node
/**
 * Dry-run reconciliation for Review/Manual rows. Pass --apply to write safe patches only.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (rel) => pathToFileURL(path.join(root, "dist", rel)).href;

const { getWorkspace } = await import(dist("orchestration/workspace-store.js"));
const { readJobSheetRows, updateJobSheetRows } = await import(dist("orchestration/sheets/job-sheet.js"));
const { ensureWorkspaceSchema } = await import(dist("orchestration/db.js"));
const { extractHttpUrlFromCell } = await import(dist("application/automatable-url.js"));
const { resolveApplyCapability } = await import(dist("application/ats-capability.js"));
const { priorTerminalEntry } = await import(dist("application/ledger.js"));

const apply = process.argv.includes("--apply");
const backupPath = path.join(root, "data", "manual-queue", `reconcile-backup-${new Date().toISOString().slice(0, 10)}.json`);

await ensureWorkspaceSchema();
const workspace = await getWorkspace("internal");
if (!workspace) {
  throw new Error("workspace internal not found");
}

const rows = await readJobSheetRows(workspace);
const targets = rows.filter((row) => ["Review", "Manual"].includes(String(row.Status ?? "").trim()));
const report = { scanned: targets.length, patches: [], summary: {} };

for (const row of targets) {
  const rawUrl = String(row["Job URL"] ?? "").trim();
  const normalized = extractHttpUrlFromCell(rawUrl);
  const capability = normalized ? resolveApplyCapability(normalized) : "invalid";
  const prior = normalized ? priorTerminalEntry(normalized) : null;
  let recommendation = "keep";
  const patch = {};
  if (!normalized) {
    recommendation = "invalid_url_review";
    patch.Notes = `${String(row.Notes ?? "")}\nRECONCILE invalid_url`.trim();
  } else if (rawUrl !== normalized) {
    recommendation = "normalize_url";
    patch["Job URL"] = normalized;
  } else if (prior?.confirmationDetected) {
    recommendation = "mark_applied_evidence";
    patch.Status = "Applied";
  } else if (capability === "invalid") {
    recommendation = "closed_invalid";
    patch.Status = "Closed";
  }
  report.patches.push({
    row_number: row.row_number,
    company: row.Company,
    status: row.Status,
    recommendation,
    capability,
    patch,
  });
}

report.summary = report.patches.reduce((acc, item) => {
  acc[item.recommendation] = (acc[item.recommendation] ?? 0) + 1;
  return acc;
}, {});

import fs from "node:fs";
fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows: targets }, null, 2));
console.log(JSON.stringify({ backupPath, apply, ...report.summary }, null, 2));

if (apply) {
  const writable = report.patches.filter((p) => Object.keys(p.patch).length > 0 && p.row_number);
  const patches = writable.map((p) => ({ rowNumber: p.row_number, patch: p.patch }));
  if (patches.length) {
    await updateJobSheetRows(workspace, patches, 40);
  }
  console.log(JSON.stringify({ rowsPatched: patches.length }));
}
