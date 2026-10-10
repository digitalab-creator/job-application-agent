#!/usr/bin/env npx tsx
/**
 * Dry-run reconciliation for misclassified GotFriends "Applied" ledger rows.
 * Usage: npx tsx scripts/reconcile-agency-scope.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { gotFriendsPostingIdFromUrl } from "../src/application/submission-scope.js";

const apply = process.argv.includes("--apply");
const ledgerPath = process.env.LEDGER_PATH?.trim() || path.join("data", "ledger", "applications.jsonl");

type Row = Record<string, unknown>;

function main(): void {
  if (!fs.existsSync(ledgerPath)) {
    console.log(JSON.stringify({ ledgerPath, rows: 0, candidates: [] }));
    return;
  }
  const lines = fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean);
  const candidates: Array<{ index: number; before: Row; after: Row }> = [];
  lines.forEach((line, index) => {
    try {
      const row = JSON.parse(line) as Row;
      const url = String(row.url ?? "");
      if (!/gotfriends\.co\.il/i.test(url)) {
        return;
      }
      if (!row.confirmationDetected) {
        return;
      }
      const postingId = gotFriendsPostingIdFromUrl(url);
      const scope = postingId ? "agency_job_interest" : "agency_registration";
      const needsFix = row.submissionScope !== scope
        || (scope === "agency_registration" && row.submissionScope === undefined);
      if (!needsFix) {
        return;
      }
      const after = {
        ...row,
        submissionScope: scope,
        agencyId: "gotfriends.co.il",
        postingId: postingId ?? undefined,
        dedupKey: postingId
          ? `agency_job:internal:gotfriends.co.il:${postingId}`
          : "agency_reg:internal:gotfriends.co.il",
        reconciliationNote: "agency_scope_correction_2026-10-10",
      };
      candidates.push({ index, before: row, after });
    } catch {
      // skip bad lines
    }
  });
  console.log(JSON.stringify({
    ledgerPath,
    dryRun: !apply,
    candidateCount: candidates.length,
    candidates: candidates.map((c) => ({
      url: c.before.url,
      scope: c.after.submissionScope,
      postingId: c.after.postingId,
    })),
  }, null, 2));
  if (!apply || candidates.length === 0) {
    return;
  }
  const backup = `${ledgerPath}.bak-${Date.now()}`;
  fs.copyFileSync(ledgerPath, backup);
  const next = [...lines];
  for (const item of candidates) {
    next[item.index] = JSON.stringify(item.after);
  }
  fs.writeFileSync(ledgerPath, `${next.join("\n")}\n`);
  console.log(`Wrote ${candidates.length} corrections. Backup: ${backup}`);
}

main();
