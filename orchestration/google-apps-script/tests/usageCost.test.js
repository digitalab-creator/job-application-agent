const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'UsageCost.js'],
  [
    'normalizeUsage_',
    'countWebSearchCalls_',
    'estimateUsageCostUsd_',
    'addUsage_',
    'summarizeRunCost_',
    'emptyUsage_',
  ]
);

test('usage is read from the Responses API shape', () => {
  const usage = api.normalizeUsage_({
    input_tokens: 48000,
    input_tokens_details: { cached_tokens: 32000 },
    output_tokens: 2500,
    total_tokens: 50500,
  });

  assert.equal(usage.inputTokens, 48000);
  assert.equal(usage.cachedInputTokens, 32000);
  assert.equal(usage.outputTokens, 2500);
});

test('missing usage degrades to zeros instead of throwing', () => {
  const usage = api.normalizeUsage_(undefined);
  assert.deepEqual(usage, api.emptyUsage_());
});

test('web search calls are counted from response output items', () => {
  const count = api.countWebSearchCalls_({
    output: [
      { type: 'web_search_call' },
      { type: 'web_search_call' },
      { type: 'message', content: [{ type: 'output_text', text: '{}' }] },
    ],
  });
  assert.equal(count, 2);
});

test('cost splits cached and fresh input at their own rates', () => {
  // 16k fresh @ $2/1M + 32k cached @ $0.50/1M + 2.5k output @ $8/1M + 5 searches @ $0.01
  const cost = api.estimateUsageCostUsd_({
    inputTokens: 48000,
    cachedInputTokens: 32000,
    outputTokens: 2500,
    webSearchCalls: 5,
  }, 'gpt-4.1');

  const expected = (16000 / 1e6) * 2 + (32000 / 1e6) * 0.5 + (2500 / 1e6) * 8 + 5 * 0.01;
  assert.ok(Math.abs(cost - expected) < 1e-9);
});

test('an unknown model falls back to flagship pricing rather than reporting zero', () => {
  const usage = { inputTokens: 1e6, cachedInputTokens: 0, outputTokens: 0, webSearchCalls: 0 };
  assert.equal(api.estimateUsageCostUsd_(usage, 'gpt-9-does-not-exist'), 2);
  assert.equal(api.estimateUsageCostUsd_(usage, 'gpt-4.1-mini'), 0.4);
});

test('cached tokens cannot exceed input tokens', () => {
  const cost = api.estimateUsageCostUsd_({
    inputTokens: 1000,
    cachedInputTokens: 5000,
    outputTokens: 0,
    webSearchCalls: 0,
  }, 'gpt-4.1');

  assert.equal(cost, (1000 / 1e6) * 0.5);
});

test('run totals accumulate across sources and project to a month', () => {
  const perCall = {
    inputTokens: 48000,
    cachedInputTokens: 32000,
    outputTokens: 2500,
    webSearchCalls: 5,
  };

  let total = api.emptyUsage_();
  for (let i = 0; i < 12; i += 1) total = api.addUsage_(total, perCall);

  assert.equal(total.inputTokens, 576000);
  assert.equal(total.webSearchCalls, 60);

  const report = api.summarizeRunCost_(total, 'gpt-4.1');
  assert.ok(report.estimatedRunCostUsd > 0);
  // Projection is the run cost over a month of daily runs, allowing for rounding.
  assert.ok(Math.abs(report.projectedMonthlyUsd - report.estimatedRunCostUsd * 30) < 0.01);
  assert.equal(report.model, 'gpt-4.1');
});
