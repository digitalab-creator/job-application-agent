/**
 * Token usage and cost accounting for OpenAI calls.
 * Prices live in CONFIG.MODEL_PRICING_USD — single source of truth.
 *
 * The web_search figure is a floor: OpenAI bills each internal sub-search, and
 * sub-searches are not reported in the response.
 */
const TOKENS_PER_MILLION = 1000000;

function emptyUsage_() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    webSearchCalls: 0,
  };
}

function normalizeUsage_(usageJson) {
  const usage = usageJson || {};
  const details = usage.input_tokens_details || {};
  return {
    inputTokens: Number(usage.input_tokens) || 0,
    cachedInputTokens: Number(details.cached_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    webSearchCalls: 0,
  };
}

function countWebSearchCalls_(responseJson) {
  return (responseJson.output || [])
    .filter((item) => item && item.type === 'web_search_call')
    .length;
}

function modelPricing_(model) {
  return CONFIG.MODEL_PRICING_USD[cleanString_(model)] || CONFIG.FALLBACK_MODEL_PRICING_USD;
}

function estimateUsageCostUsd_(usage, model) {
  const pricing = modelPricing_(model);
  const inputTokens = Number(usage.inputTokens) || 0;
  const cachedTokens = Math.min(Number(usage.cachedInputTokens) || 0, inputTokens);
  const freshTokens = inputTokens - cachedTokens;

  return (freshTokens / TOKENS_PER_MILLION) * pricing.input
    + (cachedTokens / TOKENS_PER_MILLION) * pricing.cachedInput
    + ((Number(usage.outputTokens) || 0) / TOKENS_PER_MILLION) * pricing.output
    + (Number(usage.webSearchCalls) || 0) * (Number(CONFIG.WEB_SEARCH_CALL_USD) || 0);
}

function addUsage_(total, addition) {
  const source = addition || emptyUsage_();
  return {
    inputTokens: total.inputTokens + (Number(source.inputTokens) || 0),
    cachedInputTokens: total.cachedInputTokens + (Number(source.cachedInputTokens) || 0),
    outputTokens: total.outputTokens + (Number(source.outputTokens) || 0),
    webSearchCalls: total.webSearchCalls + (Number(source.webSearchCalls) || 0),
  };
}

function roundUsd_(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

/**
 * Run-level cost report for the Automation Log, including a monthly projection
 * so a single run answers "what is this costing me?".
 */
function summarizeRunCost_(usage, model) {
  const runCost = estimateUsageCostUsd_(usage, model);
  const runsPerMonth = Number(CONFIG.RUNS_PER_MONTH) || 30;

  return {
    model,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    webSearchCallsReported: usage.webSearchCalls,
    estimatedRunCostUsd: roundUsd_(runCost),
    projectedMonthlyUsd: roundUsd_(runCost * runsPerMonth),
  };
}
