import assert from "node:assert/strict";
import test from "node:test";
import { mapApplyResultToSheetPatch } from "./sheet-result.js";

test("sheet stays off Applied until worker reports applied status", () => {
  const row = { row_number: 5, Company: "Acme", Role: "Eng", "Job URL": "https://example.com/j/1" };
  const unconfirmed = mapApplyResultToSheetPatch(
    row,
    {
      status: "review",
      jobUrl: "https://example.com/j/1",
      submitted: true,
      confirmationDetected: false,
      blocker: "submitted_unconfirmed",
      notes: "still waiting",
    },
    "UTC",
  );
  assert.notEqual(unconfirmed.Status, "Applied");

  const confirmed = mapApplyResultToSheetPatch(
    row,
    {
      status: "applied",
      jobUrl: "https://example.com/j/1",
      submitted: true,
      confirmationDetected: true,
      notes: "confirmed",
    },
    "UTC",
  );
  assert.equal(confirmed.Status, "Applied");
});
