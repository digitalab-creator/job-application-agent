import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordExternalSpend } from "../llm/cost-ledger.js";
import { budgetSnapshot, monthlyBudgetLimitIls, usdToIls } from "./monthly-budget.js";

test("usd converts to ils with the configured rate", () => {
  assert.equal(usdToIls(10, 3.65), 36.5);
});

test("hosting reserve counts only when MONTHLY_FIXED_COST_ILS is set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-"));
  const previousLedger = process.env.COST_LEDGER_PATH;
  const previousBudget = process.env.MONTHLY_BUDGET_ILS;
  const previousFixed = process.env.MONTHLY_FIXED_COST_ILS;
  const previousRate = process.env.USD_ILS_RATE;
  process.env.COST_LEDGER_PATH = path.join(dir, "costs.jsonl");
  process.env.MONTHLY_BUDGET_ILS = "500";
  process.env.MONTHLY_FIXED_COST_ILS = "0";
  process.env.USD_ILS_RATE = "3.65";
  try {
    recordExternalSpend({
      month: budgetSnapshot().month,
      source: "platform",
      label: "monthly_infra",
      ils: 150,
      usd: 0,
    });
    const snap = budgetSnapshot();
    assert.equal(snap.limitIls, 500);
    assert.equal(snap.fixedCostIls, 0);
    assert.equal(snap.spentIls, 0);
    assert.equal(snap.remainingIls, 500);
    assert.equal(snap.open, true);
    process.env.MONTHLY_FIXED_COST_ILS = "150";
    const withFixed = budgetSnapshot();
    assert.equal(withFixed.fixedCostIls, 150);
    assert.equal(withFixed.spentIls, 150);
    assert.equal(withFixed.remainingIls, 350);
  } finally {
    if (previousLedger === undefined) {
      delete process.env.COST_LEDGER_PATH;
    } else {
      process.env.COST_LEDGER_PATH = previousLedger;
    }
    if (previousBudget === undefined) {
      delete process.env.MONTHLY_BUDGET_ILS;
    } else {
      process.env.MONTHLY_BUDGET_ILS = previousBudget;
    }
    if (previousFixed === undefined) {
      delete process.env.MONTHLY_FIXED_COST_ILS;
    } else {
      process.env.MONTHLY_FIXED_COST_ILS = previousFixed;
    }
    if (previousRate === undefined) {
      delete process.env.USD_ILS_RATE;
    } else {
      process.env.USD_ILS_RATE = previousRate;
    }
  }
});

test("default monthly cap is 500 ils", () => {
  const previous = process.env.MONTHLY_BUDGET_ILS;
  delete process.env.MONTHLY_BUDGET_ILS;
  try {
    assert.equal(monthlyBudgetLimitIls(), 500);
  } finally {
    if (previous === undefined) {
      delete process.env.MONTHLY_BUDGET_ILS;
    } else {
      process.env.MONTHLY_BUDGET_ILS = previous;
    }
  }
});
