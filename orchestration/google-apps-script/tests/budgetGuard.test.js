const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

// Apps Script date formatting, reduced to the tokens BudgetGuard actually uses.
const Utilities = {
  formatDate(date, _timeZone, format) {
    const iso = date.toISOString();
    if (format === 'yyyy-MM') return iso.slice(0, 7);
    if (format === 'yyyy') return iso.slice(0, 4);
    if (format === 'MM') return iso.slice(5, 7);
    if (format === 'dd') return iso.slice(8, 10);
    throw new Error(`Unexpected format in test stub: ${format}`);
  },
};

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'UsageCost.js', 'BudgetGuard.js'],
  [
    'monthlyBudgetUsd_',
    'daysRemainingInMonth_',
    'paceRunBudgetUsd_',
    'affordableCallCount_',
    'budgetPeriodKey_',
    'budgetReport_',
  ],
  { Utilities, PropertiesService: {} }
);

test('the ILS budget converts to spendable USD with safety headroom', () => {
  // 100 ILS at 3.7 ILS/USD is $27.03, of which we may spend 85% to leave room for
  // sub-searches OpenAI bills but does not report.
  assert.ok(Math.abs(api.monthlyBudgetUsd_(100) - 22.97) < 0.01);
  assert.equal(api.monthlyBudgetUsd_(0), 0);
});

test('spend is paced over the days left in the month', () => {
  // Early August: 31 days total, 24 remaining from the 8th.
  assert.equal(api.daysRemainingInMonth_(new Date('2026-08-08T09:00:00Z')), 24);
  assert.equal(api.daysRemainingInMonth_(new Date('2026-08-31T09:00:00Z')), 1);
  assert.equal(api.daysRemainingInMonth_(new Date('2026-02-01T09:00:00Z')), 28);

  // A full budget on the 8th spreads over the remaining 24 days, not all at once.
  const perRun = api.paceRunBudgetUsd_(27.03, 24);
  assert.ok(Math.abs(perRun - 1.126) < 0.01);
});

test('pacing never returns a negative allowance when overspent', () => {
  assert.equal(api.paceRunBudgetUsd_(-5, 10), 0);
  assert.equal(api.paceRunBudgetUsd_(10, 0), 10);
});

test('affordable call count derives from the measured average cost', () => {
  // $1.13 of allowance at $0.15 per call funds 7 sources, under the ceiling of 12.
  assert.equal(api.affordableCallCount_(1.13, 0.15, 12), 7);
  // Cheaper calls are capped by the configured ceiling, not the budget.
  assert.equal(api.affordableCallCount_(1.13, 0.01, 12), 12);
  // An allowance too small for one call funds nothing, so the run skips searching.
  assert.equal(api.affordableCallCount_(0.05, 0.15, 12), 0);
});

test('the ledger period is a calendar month so it resets on rollover', () => {
  assert.equal(api.budgetPeriodKey_(new Date('2026-08-31T21:00:00Z')), '2026-08');
  assert.notEqual(
    api.budgetPeriodKey_(new Date('2026-09-01T09:00:00Z')),
    api.budgetPeriodKey_(new Date('2026-08-31T09:00:00Z'))
  );
});

test('the report states remaining budget in ILS, the unit the budget was set in', () => {
  const budget = {
    period: '2026-08',
    budgetIls: 100,
    spentUsd: 10,
    runBudgetUsd: 1.13,
    avgCallCostUsd: 0.15,
  };
  const report = api.budgetReport_(budget, 2, 3);

  // 12 USD spent at 3.7 = 44.4 ILS, leaving 55.6 of 100.
  assert.equal(report.monthSpentUsd, 12);
  assert.equal(report.monthSpentIls, 44.4);
  assert.equal(report.monthRemainingIls, 55.6);
  assert.equal(report.callsSkippedForBudget, 3);
});
