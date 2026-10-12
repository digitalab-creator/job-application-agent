import assert from "node:assert/strict";
import test from "node:test";
import { selectApplyDailyBatch } from "../discovery/queue-mix.js";
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

test("LinkedIn job URLs stay out of auto-pick while Easy Apply is off", () => {
  const previous = process.env.LINKEDIN_EASY_APPLY_ENABLED;
  const job: JobSheetRow[] = [
    {
      row_number: 9,
      Status: "New",
      Company: "Linked",
      Role: "Engineer",
      Category: "Growth Engineering",
      "Match Score": "99",
      "Job URL": "https://www.linkedin.com/jobs/view/4412564650",
    },
  ];
  const list: JobSheetRow[] = [
    {
      row_number: 10,
      Status: "New",
      Company: "Friends",
      Role: "Engineer",
      Category: "Growth Engineering",
      "Match Score": "99",
      "Job URL": "https://www.gotfriends.co.il/jobslobby/ai/?page=1&total=11",
    },
  ];
  delete process.env.LINKEDIN_EASY_APPLY_ENABLED;
  try {
    assert.equal(filterEligibleApplyRows(job, []).length, 0);
    assert.equal(filterEligibleApplyRows(list, []).length, 0);
    process.env.LINKEDIN_EASY_APPLY_ENABLED = "true";
    assert.equal(filterEligibleApplyRows(job, []).length, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.LINKEDIN_EASY_APPLY_ENABLED;
    } else {
      process.env.LINKEDIN_EASY_APPLY_ENABLED = previous;
    }
  }
});

test("pickWorkspaceApplyBatch respects eligibility and mix", () => {
  const excluded = ["Hunt", "בורודה קפלן"];
  const eligible = filterEligibleApplyRows(fixture, excluded);
  assert.equal(eligible.length, 2);
  const batch = pickWorkspaceApplyBatch(fixture, excluded, 20);
  assert.equal(batch.selected.length, 2);
  assert.equal(batch.pickedTech, 0);
  assert.equal(batch.pickedMarketing, 2);
  const sorted = [...eligible].sort(
    (a, b) =>
      sheetMatchScore(b) - sheetMatchScore(a)
      || String(b["Found Date"] ?? "").localeCompare(String(a["Found Date"] ?? "")),
  );
  const mapped = sorted.map((row) => ({ row, category: String(row.Category ?? "") }));
  const ssot = selectApplyDailyBatch(mapped, (item) => sheetMatchScore(item.row));
  assert.deepEqual(
    batch.selected.map((row) => row.row_number),
    ssot.selected.map((item) => item.row.row_number),
  );
});
