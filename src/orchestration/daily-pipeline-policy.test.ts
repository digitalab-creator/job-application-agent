import assert from "node:assert/strict";
import test from "node:test";
import { shouldStopAfterEmptyApply } from "./daily-pipeline-policy.js";

test("stops when daily budget is spent", () => {
  const out = shouldStopAfterEmptyApply({
    dailyBudgetOpen: false,
    lastDiscoverAdded: 5,
    automatableEmployment: 0,
  });
  assert.equal(out.stop, true);
  if (out.stop) assert.equal(out.reason, "daily_budget_spent");
});

test("retries discover when budget remains and last discover added rows", () => {
  const out = shouldStopAfterEmptyApply({
    dailyBudgetOpen: true,
    lastDiscoverAdded: 3,
    automatableEmployment: 0,
  });
  assert.deepEqual(out, { stop: false });
});

test("stops when last discover added zero rows", () => {
  const out = shouldStopAfterEmptyApply({
    dailyBudgetOpen: true,
    lastDiscoverAdded: 0,
    automatableEmployment: 0,
  });
  assert.equal(out.stop, true);
  if (out.stop) assert.equal(out.reason, "discover_added_zero");
});

test("stops when automatable rows still on sheet but pick returned nothing", () => {
  const out = shouldStopAfterEmptyApply({
    dailyBudgetOpen: true,
    lastDiscoverAdded: null,
    automatableEmployment: 2,
  });
  assert.equal(out.stop, true);
  if (out.stop) assert.equal(out.reason, "automatable_jobs_remain_unpicked");
});
