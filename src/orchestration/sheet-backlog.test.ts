import assert from "node:assert/strict";
import test from "node:test";
import { countUnresolvedSheetRows, shouldSkipDiscoveryForUnresolvedBacklog } from "./sheet-backlog.js";

test("unresolved backlog counts Review and Manual only", () => {
  const n = countUnresolvedSheetRows([
    { Status: "Review" },
    { Status: "Manual" },
    { Status: "New" },
    { Status: "Applied" },
  ]);
  assert.equal(n, 2);
});

test("400 historical exceptions with zero actionable supply does not block discovery", () => {
  const skip = shouldSkipDiscoveryForUnresolvedBacklog({
    unresolvedReviewManual: 400,
    actionableAutomatable: 0,
    threshold: 100,
    minActionableToPauseDiscovery: 20,
  });
  assert.equal(skip, false);
});

test("high backlog plus full actionable queue pauses discovery", () => {
  const skip = shouldSkipDiscoveryForUnresolvedBacklog({
    unresolvedReviewManual: 150,
    actionableAutomatable: 25,
    threshold: 100,
    minActionableToPauseDiscovery: 20,
  });
  assert.equal(skip, true);
});
