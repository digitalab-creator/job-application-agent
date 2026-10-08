import assert from "node:assert/strict";
import test from "node:test";
import { filterEligibleApplyRows, pickWorkspaceApplyBatch, sheetMatchScore } from "./pick-jobs.js";
import type { JobSheetRow } from "./sheets/job-sheet.js";

const fixture: JobSheetRow[] = [
  {
    row_number: 2,
    Status: "New",
    Company: "Acme",
    Role: "Engineer",
    Category: "Growth Engineering",
    "Match Score": "88",
    "Job URL": "https://www.comeet.com/jobs/acme/1.001/engineer/AA.11",
    "Found Date": "2026-10-01",
  },
  {
    row_number: 3,
    Status: "New",
    Company: "Beta",
    Role: "PMM",
    Category: "Growth Marketing",
    "Match Score": "72",
    "Job URL": "https://boards.greenhouse.io/beta/jobs/2",
    "Found Date": "2026-10-02",
  },
  {
    row_number: 4,
    Status: "Applied",
    Company: "Old",
    Role: "Skip",
    Category: "Growth Engineering",
    "Match Score": "99",
    "Job URL": "https://jobs.example.com/old",
  },
  {
    row_number: 5,
    Status: "New",
    Company: "בורודה קפלן",
    Role: "Excluded",
    Category: "Growth Engineering",
    "Match Score": "95",
    "Job URL": "https://jobs.example.com/excluded",
  },
];

test("sheetMatchScore parses numeric match score", () => {
  assert.equal(sheetMatchScore({ "Match Score": "82%" }), 82);
});

test("aggregator URLs are not auto-pick eligible", () => {
  const rows: JobSheetRow[] = [
    {
      row_number: 9,
      Status: "New",
      Company: "Linked",
      Role: "Engineer",
      Category: "Growth Engineering",
      "Match Score": "99",
      "Job URL": "https://www.linkedin.com/jobs/view/1",
    },
  ];
  assert.equal(filterEligibleApplyRows(rows, []).length, 0);
});

test("pickWorkspaceApplyBatch respects eligibility and mix", () => {
  const excluded = ["Hunt", "בורודה קפלן"];
  const eligible = filterEligibleApplyRows(fixture, excluded);
  assert.equal(eligible.length, 2);
  const batch = pickWorkspaceApplyBatch(fixture, excluded, 20);
  assert.equal(batch.selected.length, 2);
  assert.equal(batch.pickedTech, 1);
  assert.equal(batch.pickedMarketing, 1);
});
