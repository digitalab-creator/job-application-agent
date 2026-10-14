#!/usr/bin/env node
/**
 * Backlog cleanup for New rows: never promote to Manual from capability alone.
 * Verifies posting liveness before changing Status. Dry-run by default; pass --apply.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (rel) => pathToFileURL(path.join(root, "dist", rel)).href;

const { getWorkspace } = await import(dist("orchestration/workspace-store.js"));
const { readJobSheetRows, updateJobSheetRows } = await import(dist("orchestration/sheets/job-sheet.js"));
const { resolveApplyCapability } = await import(dist("application/ats-capability.js"));
const { inspectJobUrl } = await import(dist("application/link-liveness.js"));
const {
  recommendQueueStatus,
  recommendStatusFromCapabilityOnly,
  recoverCanonicalJobUrls,
} = await import(dist("application/queue-sheet-verdict.js"));
const { ensureWorkspaceSchema } = await import(dist("orchestration/db.js"));

const apply = process.argv.includes("--apply");
const onlyManual = process.argv.includes("--manual-only-audit");

await ensureWorkspaceSchema();
const workspace = await getWorkspace("internal");
if (!workspace) {
  throw new Error("workspace internal not found — seed first");
}

const rows = await readJobSheetRows(workspace);
const targets = onlyManual
  ? rows.filter((row) => String(row.Status ?? "").trim() === "Manual")
  : rows.filter((row) => String(row.Status ?? "").trim() === "New");
const summary = { kept: 0, manual: 0, review: 0, closed: 0, new: 0, written: 0 };
const patches = [];
const verifiedAt = new Date().toISOString();

for (const row of targets) {
  const rawUrl = String(row["Job URL"] ?? "").trim();
  const capability = rawUrl.startsWith("http") ? resolveApplyCapability(rawUrl) : "invalid";
  const classifyOnly = recommendStatusFromCapabilityOnly(capability, rawUrl);
  if (!rawUrl.startsWith("http")) {
    summary.review += 1;
    const rec = {
      row_number: row.row_number,
      company: row.Company,
      capability,
      from: row.Status,
      to: "Review",
      reason: "invalid_url",
      write: apply,
    };
    console.log(JSON.stringify(rec));
    if (apply && row.row_number) {
      patches.push({
        rowNumber: row.row_number,
        patch: {
          Status: "Review",
          Notes: `${String(row.Notes ?? "")}\nAUTO_CLASSIFY invalid_url → Review`.trim(),
        },
      });
    }
    continue;
  }

  const url = recoverCanonicalJobUrls(rawUrl)[0] ?? rawUrl;
  const liveness = await inspectJobUrl(url, String(row.Role ?? ""));
  const recommendation = recommendQueueStatus({
    currentStatus: String(row.Status ?? "New"),
    notes: String(row.Notes ?? ""),
    rawJobUrl: rawUrl,
    role: String(row.Role ?? ""),
    capability,
    liveness,
    verifiedAt,
  });

  const next = recommendation?.status ?? classifyOnly;
  if (next === "Manual") summary.manual += 1;
  else if (next === "Closed") summary.closed += 1;
  else if (next === "Review") summary.review += 1;
  else summary.new += 1;

  const noteLine = `AUTO_CLASSIFY capability=${capability} verify=${recommendation?.reason ?? classifyOnly} → ${next}`;
  const prevNotes = String(row.Notes ?? "").trim();
  const notes = prevNotes.includes("AUTO_CLASSIFY") && !apply
    ? prevNotes
    : [recommendation?.notesPatch, noteLine, prevNotes].filter(Boolean).join("\n");

  console.log(
    JSON.stringify({
      row_number: row.row_number,
      company: row.Company,
      capability,
      from: row.Status,
      to: next,
      evidence: recommendation?.evidence ?? liveness.reason,
      url: url.slice(0, 120),
      write: apply,
    }),
  );

  if (!row.row_number) {
    continue;
  }
  const patch = { Notes: notes };
  if (next !== String(row.Status ?? "").trim()) {
    patch.Status = next;
  }
  if (recommendation?.canonicalUrl && recommendation.canonicalUrl !== rawUrl) {
    patch["Job URL"] = recommendation.canonicalUrl;
  }
  if (apply && (patch.Status || patch["Job URL"])) {
    patches.push({ rowNumber: row.row_number, patch });
  } else if (apply && patch.Notes !== prevNotes) {
    patches.push({ rowNumber: row.row_number, patch });
  }
}

if (apply && patches.length) {
  await updateJobSheetRows(workspace, patches, 40);
  summary.written = patches.length;
  console.log(JSON.stringify({ rowsPatched: patches.length }));
}

console.log(JSON.stringify({ apply, targets: targets.length, onlyManual, ...summary }, null, 2));
