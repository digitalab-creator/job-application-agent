import assert from "node:assert/strict";
import test from "node:test";
import { findJobSheetRow } from "./job-sheet-lookup.js";

test("findJobSheetRow resolves high row numbers outside queue preview cap", () => {
  const rows = Array.from({ length: 6000 }, (_, i) => ({
    row_number: i + 2,
    Company: `Co-${i}`,
    Role: `Role-${i}`,
    "Job URL": `https://example.com/jobs/${i}`,
  }));
  const hit = findJobSheetRow(rows, { rowNumber: 4858 });
  assert.ok(hit);
  assert.equal(hit?.row_number, 4858);
  assert.equal(hit?.Company, "Co-4856");
});

test("findJobSheetRow matches job URL case-insensitively", () => {
  const rows = [{ row_number: 42, "Job URL": "https://Boards.Greenhouse.io/foo/jobs/1" }];
  const hit = findJobSheetRow(rows, { jobUrl: "https://boards.greenhouse.io/foo/jobs/1" });
  assert.equal(hit?.row_number, 42);
});
