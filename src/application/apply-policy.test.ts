import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyPickBatchSafetyCap, dailyApplyPickLimit, estimatedApplyCostIls } from "./apply-policy.js";

test("daily pick limit follows remaining paced daily budget", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-policy-"));
  const previousLedger = process.env.COST_LEDGER_PATH;
  const previousBudget = process.env.MONTHLY_BUDGET_ILS;
  const previousEstimate = process.env.ESTIMATED_APPLY_COST_ILS;
  process.env.COST_LEDGER_PATH = path.join(dir, "costs.jsonl");
  process.env.MONTHLY_BUDGET_ILS = "500";
  process.env.ESTIMATED_APPLY_COST_ILS = "2";
  try {
    const limit = dailyApplyPickLimit();
    assert.ok(limit > 0);
    assert.ok(limit <= applyPickBatchSafetyCap());
    assert.equal(estimatedApplyCostIls(), 2);
  } finally {
    if (previousLedger === undefined) delete process.env.COST_LEDGER_PATH;
    else process.env.COST_LEDGER_PATH = previousLedger;
    if (previousBudget === undefined) delete process.env.MONTHLY_BUDGET_ILS;
    else process.env.MONTHLY_BUDGET_ILS = previousBudget;
    if (previousEstimate === undefined) delete process.env.ESTIMATED_APPLY_COST_ILS;
    else process.env.ESTIMATED_APPLY_COST_ILS = previousEstimate;
  }
});
