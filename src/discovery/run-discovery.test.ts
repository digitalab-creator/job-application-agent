import assert from "node:assert/strict";
import test from "node:test";
import { withSearchPolicy } from "../config/search-policy-runtime.js";
import { defaultSearchPolicy } from "../config/search-policy.js";
import { runDiscovery } from "./run-discovery.js";

test("discovery runs when unresolved backlog is high but actionable New queue is empty", async () => {
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
