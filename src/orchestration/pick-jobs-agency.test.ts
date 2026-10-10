import assert from "node:assert/strict";
import test from "node:test";
import type { JobSheetRow } from "./sheets/job-sheet.js";
import { filterEligibleApplyRows } from "./pick-jobs.js";

const gf = (postingId: string, role: string, row: number): JobSheetRow => ({
  row_number: row,
  Status: "New",
  Company: "Startup",
  Role: role,
  Category: "Growth Engineering",
  "Match Score": "90",
  "Job URL": `https://www.gotfriends.co.il/jobslobby/ai/${role.toLowerCase().replace(/\s+/g, "-")}/${postingId}/`,
});

test("pick queue skips duplicate agency registration targets but keeps other postings", () => {
  const rows = [gf("154895", "AI Engineer", 1), gf("151469", "LLM Engineer", 2), gf("152000", "ML Engineer", 3)];
  const eligible = filterEligibleApplyRows(rows, []);
  assert.equal(eligible.length, 3);
});
