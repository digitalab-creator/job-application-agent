/**
 * Hard monthly spend cap for OpenAI calls.
 *
 * Spend is paced across the month rather than spent first-come, so the pipeline
 * cannot go dark on day 10. Each run gets (budget remaining / days remaining),
 * and the number of source calls is derived from a self-calibrating average cost
 * per call — as calls get cheaper, more sources run.
 *
 * Dry runs are metered too: they call the API and cost real money.
 */
const BUDGET_PERIOD_PROPERTY = 'BUDGET_PERIOD';
const BUDGET_SPENT_PROPERTY = 'BUDGET_SPENT_USD';
const AVG_CALL_COST_PROPERTY = 'AVG_CALL_COST_USD';
const AVG_COST_SMOOTHING = 0.3;

function monthlyBudgetUsd_(budgetIls) {
  const ils = Number(budgetIls) || 0;
  const rate = Number(CONFIG.USD_TO_ILS_RATE) || 3.7;
  const safety = Number(CONFIG.BUDGET_SAFETY_FACTOR) || 1;
  return (ils / rate) * safety;
}

function budgetPeriodKey_(date) {
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM');
}

function daysRemainingInMonth_(date) {
  const year = Number(Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy'));
  const month = Number(Utilities.formatDate(date, CONFIG.TIME_ZONE, 'MM'));
  const day = Number(Utilities.formatDate(date, CONFIG.TIME_ZONE, 'dd'));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.max(1, daysInMonth - day + 1);
}

function paceRunBudgetUsd_(remainingUsd, daysRemaining) {
  const remaining = Math.max(0, Number(remainingUsd) || 0);
  return remaining / Math.max(1, Number(daysRemaining) || 1);
}

function affordableCallCount_(runBudgetUsd, avgCallCostUsd, maxCalls) {
  const cap = Math.max(0, Number(maxCalls) || 0);
  const avgCost = Number(avgCallCostUsd) || 0;
  if (avgCost <= 0) return cap;
  return Math.max(0, Math.min(cap, Math.floor((Number(runBudgetUsd) || 0) / avgCost)));
}

/**
 * Ledger resets itself when the calendar month rolls over.
 */
function readBudgetLedger_(now) {
  const props = PropertiesService.getScriptProperties();
  const period = budgetPeriodKey_(now);
  const storedPeriod = cleanString_(props.getProperty(BUDGET_PERIOD_PROPERTY));

  if (storedPeriod !== period) {
    props.setProperties({
      [BUDGET_PERIOD_PROPERTY]: period,
      [BUDGET_SPENT_PROPERTY]: '0',
    });
    return { period, spentUsd: 0 };
  }

  return {
    period,
    spentUsd: Number(props.getProperty(BUDGET_SPENT_PROPERTY)) || 0,
  };
}

function recordBudgetSpend_(usd, now) {
  const amount = Number(usd) || 0;
  if (amount <= 0) return;
  const ledger = readBudgetLedger_(now);
  PropertiesService.getScriptProperties().setProperty(
    BUDGET_SPENT_PROPERTY,
    String(roundUsd_(ledger.spentUsd + amount))
  );
}

function readAvgCallCostUsd_() {
  const stored = Number(PropertiesService.getScriptProperties().getProperty(AVG_CALL_COST_PROPERTY));
  return stored > 0 ? stored : Number(CONFIG.ESTIMATED_CALL_COST_USD) || 0.15;
}

/**
 * Feeds the rolling average that decides how many rotation sources a run can afford.
 * Pass only comparable web-search calls; a cheaper kind of call would understate the
 * cost of the calls this average is used to schedule.
 */
function recordCallCostUsd_(usd) {
  const amount = Number(usd) || 0;
  if (amount <= 0) return;
  const previous = readAvgCallCostUsd_();
  const smoothed = (previous * (1 - AVG_COST_SMOOTHING)) + (amount * AVG_COST_SMOOTHING);
  PropertiesService.getScriptProperties().setProperty(AVG_CALL_COST_PROPERTY, String(roundUsd_(smoothed)));
}

/**
 * Everything a run needs to decide how much it may spend.
 */
function openRunBudget_(settings, now) {
  const budgetIls = Number(settings.monthlyBudgetIls) || CONFIG.MONTHLY_BUDGET_ILS_DEFAULT;
  const monthlyUsd = monthlyBudgetUsd_(budgetIls);
  const ledger = readBudgetLedger_(now);
  const remainingUsd = Math.max(0, monthlyUsd - ledger.spentUsd);
  const daysRemaining = daysRemainingInMonth_(now);
  const runBudgetUsd = paceRunBudgetUsd_(remainingUsd, daysRemaining);
  const avgCallCostUsd = readAvgCallCostUsd_();

  return {
    period: ledger.period,
    budgetIls,
    monthlyUsd: roundUsd_(monthlyUsd),
    spentUsd: roundUsd_(ledger.spentUsd),
    remainingUsd: roundUsd_(remainingUsd),
    daysRemaining,
    runBudgetUsd: roundUsd_(runBudgetUsd),
    avgCallCostUsd,
    exhausted: remainingUsd <= 0,
  };
}

function budgetReport_(budget, runSpendUsd, callsSkipped) {
  const spentIls = (budget.spentUsd + runSpendUsd) * (Number(CONFIG.USD_TO_ILS_RATE) || 3.7);
  return {
    period: budget.period,
    monthlyBudgetIls: budget.budgetIls,
    runSpendUsd: roundUsd_(runSpendUsd),
    monthSpentUsd: roundUsd_(budget.spentUsd + runSpendUsd),
    monthSpentIls: Math.round(spentIls * 100) / 100,
    monthRemainingIls: Math.round((budget.budgetIls - spentIls) * 100) / 100,
    runBudgetUsd: budget.runBudgetUsd,
    avgCallCostUsd: budget.avgCallCostUsd,
    callsSkippedForBudget: callsSkipped,
  };
}
