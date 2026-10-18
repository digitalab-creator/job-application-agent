import assert from "node:assert/strict";
import test from "node:test";
import type { ApplyInput } from "../application/apply-job.js";
import { shouldSyncApplyOutcomeToSheet } from "../orchestration/sync-apply-outcome-to-sheet.js";

test("MCP preview apply input never syncs sheet status", () => {
  const input: ApplyInput = {
    row: 10,
    submit: false,
    mcpDryRun: true,
    workspaceId: "internal",
    job: { company: "X", role: "Y", url: "https://example.com" },
  };
  assert.equal(shouldSyncApplyOutcomeToSheet(input), false);
});
