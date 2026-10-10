#!/usr/bin/env node
/**
 * Audit ALL Manual rows (dry-run report). Pass --apply to write verified corrections.
 * Idempotent: re-run skips rows whose verify= note already matches recommendation.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (rel) => pathToFileURL(path.join(root, "dist", rel)).href;

const apply = process.argv.includes("--apply");
const { ensureWorkspaceSchema } = await import(dist("orchestration/db.js"));
const { getWorkspace } = await import(dist("orchestration/workspace-store.js"));
const { readJobSheetRows } = await import(dist("orchestration/sheets/job-sheet.js"));
const { runQueueRecheck } = await import(dist("orchestration/queue-recheck.js"));

await ensureWorkspaceSchema();
const workspace = await getWorkspace("internal");
if (!workspace) {
  throw new Error("workspace internal not found");
}

const rows = await readJobSheetRows(workspace);
const manualCount = rows.filter((r) => String(r.Status ?? "").trim() === "Manual").length;
const result = await runQueueRecheck({
  workspace,
  dryRun: !apply,
  limit: Math.max(manualCount, 60),
  offset: 0,
  statuses: ["Manual"],
});

const reportPath = path.join(
  root,
  "data",
  "manual-queue",
  `manual-audit-${new Date().toISOString().slice(0, 10)}${apply ? "-applied" : "-dry-run"}.json`,
);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({ manualCount, ...result }, null, 2));
console.log(JSON.stringify({ reportPath, manualCount, ...result.summary, changed: result.changed }, null, 2));
