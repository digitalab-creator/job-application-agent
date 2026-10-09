import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApplyInput } from "../application/apply-job.js";
import { shouldSyncApplyOutcomeToSheet } from "./sync-apply-outcome-to-sheet.js";

function baseInput(overrides: Partial<ApplyInput> = {}): ApplyInput {
  return {
    submit: true,
    row: 395,
    workspaceId: "internal",
    job: { company: "Wix", role: "Growth Engineer", url: "https://example.com/job" },
    ...overrides,
  };
}

test("shouldSyncApplyOutcomeToSheet requires row and submit true", () => {
  assert.equal(shouldSyncApplyOutcomeToSheet(baseInput()), true);
  assert.equal(shouldSyncApplyOutcomeToSheet(baseInput({ submit: false })), false);
  assert.equal(shouldSyncApplyOutcomeToSheet(baseInput({ row: undefined })), false);
  assert.equal(shouldSyncApplyOutcomeToSheet(baseInput({ row: 1 })), false);
});
