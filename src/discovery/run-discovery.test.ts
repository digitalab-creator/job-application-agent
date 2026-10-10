import assert from "node:assert/strict";
import test from "node:test";
import { withSearchPolicy } from "../config/search-policy-runtime.js";
import { defaultSearchPolicy } from "../config/search-policy.js";

function seedMinimalApplyEnv(): void {
  process.env.APPLY_API_TOKEN ??= "unit-test-token";
  process.env.TECHNICAL_CV_PATH ??= "/tmp/technical-cv.pdf";
  process.env.MARKETING_CV_PATH ??= "/tmp/marketing-cv.pdf";
  process.env.LLM_API_KEY ??= "unit-test-llm-key";
}

test("discovery runs when unresolved backlog is high but actionable New queue is empty", async () => {
  seedMinimalApplyEnv();
  const { runDiscovery } = await import("./run-discovery.js");
  const policy = defaultSearchPolicy();
  const result = await withSearchPolicy(policy, async () => runDiscovery({
    existingUrls: [],
    sheetRows: Array.from({ length: 400 }, () => ({ Status: "Review" })),
    actionableAutomatable: 0,
    boardUrls: [],
  }));
  assert.equal(result.status, "skipped");
  assert.ok(!result.notes.includes("discovery_skipped=unresolved_backlog"));
  assert.ok(result.notes.includes("JOB_DISCOVERY_BOARD_URLS") || result.notes.includes("Comeet"));
});
