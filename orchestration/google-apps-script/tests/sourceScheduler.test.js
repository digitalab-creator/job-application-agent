const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'SourcesCatalog.js', 'SourcesRepository.js'],
  [
    'pickSourcesForRun_',
    'sourceShareWeight_',
    'userNotRelevantRatio_',
    'isZeroYieldPenalty_',
    'readEnabledSources_',
    'getSourcesCatalog_',
    'ACTIVE_SOURCE_IDS',
    'EMAIL_ALERT_SOURCE_TYPE',
    'SOURCE_HEADERS',
    'PARKED_SOURCE_STATUSES',
    'TOS_RESTRICTED_SOURCE_IDS',
  ],
  { SpreadsheetApp: {}, Utilities: {} }
);

const NOW = new Date('2026-08-08T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function source(overrides) {
  return Object.assign({
    source_id: 'web_generic',
    type: 'web_jobs',
    opportunity_types: 'Job',
    query_or_url: 'example.com',
    priority: 3,
    llm_relevant: 0,
    user_relevant: 0,
    user_not_relevant: 0,
    runs: 0,
    lastRunAt: new Date(NOW.getTime() - DAY_MS),
  }, overrides);
}

test('healthy sources share weight equally regardless of past yield', () => {
  const producer = source({ source_id: 'web_ats_lever', llm_relevant: 10, runs: 5 });
  const quiet = source({ source_id: 'web_ats_workable', llm_relevant: 0, runs: 3 });

  assert.equal(api.sourceShareWeight_(producer), 1);
  assert.equal(api.sourceShareWeight_(quiet), 1);
});

test('zero usable results across 7 runs earns a smaller share, not a hard kick', () => {
  const barren = source({ source_id: 'il_barren', llm_relevant: 0, runs: 7 });
  assert.equal(api.isZeroYieldPenalty_(barren), true);
  assert.equal(api.sourceShareWeight_(barren), 0.25);
});

test('high user Not Relevant rate earns a smaller share', () => {
  const noisy = source({
    source_id: 'fb_noisy',
    user_relevant: 1,
    user_not_relevant: 9,
    runs: 2,
    llm_relevant: 5,
  });
  assert.ok(api.userNotRelevantRatio_(noisy) >= 0.7);
  assert.equal(api.sourceShareWeight_(noisy), 0.25);
});

test('a tiny Not Relevant sample does not penalize yet', () => {
  const thin = source({
    source_id: 'il_thin',
    user_relevant: 0,
    user_not_relevant: 2,
    llm_relevant: 2,
    runs: 2,
  });
  assert.equal(api.userNotRelevantRatio_(thin), 0);
  assert.equal(api.sourceShareWeight_(thin), 1);
});

test('equal-weight sources rotate by who waited longest', () => {
  const recent = source({
    source_id: 'il_recent',
    lastRunAt: new Date(NOW.getTime() - DAY_MS),
  });
  const stale = source({
    source_id: 'il_stale',
    lastRunAt: new Date(NOW.getTime() - 10 * DAY_MS),
  });

  const picked = api.pickSourcesForRun_([recent, stale], 1, NOW);
  assert.equal(picked[0].source_id, 'il_stale');
});

test('penalized sources only fill leftover slots after full-share sources', () => {
  const healthy = [];
  for (let i = 0; i < 5; i += 1) {
    healthy.push(source({
      source_id: `il_ok_${i}`,
      lastRunAt: new Date(NOW.getTime() - (i + 1) * DAY_MS),
    }));
  }
  const penalized = source({
    source_id: 'il_penalized',
    llm_relevant: 0,
    runs: 7,
    lastRunAt: new Date(NOW.getTime() - 30 * DAY_MS),
  });

  const picked = api.pickSourcesForRun_(healthy.concat(penalized), 5, NOW);
  assert.equal(picked.length, 5);
  assert.ok(picked.every((item) => item.source_id !== 'il_penalized'));

  const withRoom = api.pickSourcesForRun_(healthy.concat(penalized), 6, NOW);
  assert.ok(withRoom.some((item) => item.source_id === 'il_penalized'));
});

test('Drushim and Facebook get equal shots when both are healthy', () => {
  const pool = [
    source({
      source_id: 'fb_ai_il',
      type: 'facebook_group',
      opportunity_types: 'Freelance',
      lastRunAt: new Date(NOW.getTime() - 5 * DAY_MS),
    }),
    source({
      source_id: 'il_drushim',
      query_or_url: 'https://www.drushim.co.il/',
      lastRunAt: new Date(NOW.getTime() - 5 * DAY_MS),
    }),
    source({
      source_id: 'web_ats_comeet',
      query_or_url: 'comeet.com',
      lastRunAt: new Date(NOW.getTime() - 2 * DAY_MS),
    }),
  ];

  assert.equal(api.sourceShareWeight_(pool[0]), 1);
  assert.equal(api.sourceShareWeight_(pool[1]), 1);

  const picked = api.pickSourcesForRun_(pool, 2, NOW);
  const ids = picked.map((item) => item.source_id).sort();
  assert.deepEqual(ids, ['fb_ai_il', 'il_drushim']);
});

function sheetRow(overrides) {
  const row = new Array(api.SOURCE_HEADERS.length).fill('');
  const base = Object.assign({
    source_id: 'il_drushim',
    type: 'web_jobs',
    label: 'Drushim',
    query_or_url: 'https://www.drushim.co.il/',
    scrape_tier: 'search',
    mode: 'auto',
    opportunity_types: 'Job',
    enabled: true,
    priority: 1,
    runs: 9,
    status: 'active',
  }, overrides);
  Object.keys(base).forEach((key) => {
    row[api.SOURCE_HEADERS.indexOf(key)] = base[key];
  });
  return row;
}

function fakeSourcesSheet(rows) {
  return {
    getLastRow: () => rows.length + 1,
    getRange: (startRow, startCol, numRows, numCols) => ({
      getValues: () => rows
        .slice(startRow - 2, startRow - 2 + numRows)
        .map((row) => row.slice(startCol - 1, startCol - 1 + numCols)),
    }),
  };
}

test('sources parked by an older policy come back with a clean measurement window', () => {
  api.PARKED_SOURCE_STATUSES.forEach((status) => {
    const sheet = fakeSourcesSheet([sheetRow({ status, runs: 9 })]);
    const picked = api.readEnabledSources_(sheet, { maxSourceCallsPerRun: 5 });

    assert.equal(picked.length, 1, `${status} should be scheduled again`);
    assert.equal(picked[0].freshWindow, true);
    assert.equal(picked[0].runs, 0, 'barren history must not carry over');
    assert.equal(api.sourceShareWeight_(picked[0]), 1, 'revived source gets a full share');
  });
});

test('a source switched off by hand stays off', () => {
  const sheet = fakeSourcesSheet([sheetRow({ enabled: false, status: 'active' })]);
  assert.equal(api.readEnabledSources_(sheet, { maxSourceCallsPerRun: 5 }).length, 0);
});

test('only the curated roster runs, and every rostered id exists in the catalog', () => {
  const catalog = api.getSourcesCatalog_();
  const enabled = catalog.filter((item) => item.enabled).map((item) => item.source_id).sort();

  assert.deepEqual(enabled, api.ACTIVE_SOURCE_IDS.slice().sort());
  enabled.forEach((id) => {
    assert.ok(!api.TOS_RESTRICTED_SOURCE_IDS.includes(id), `${id} may not be scraped`);
  });
});

test('scraping-restricted boards stay off and alerts-only', () => {
  const restricted = api.getSourcesCatalog_()
    .filter((item) => api.TOS_RESTRICTED_SOURCE_IDS.includes(item.source_id));

  assert.equal(restricted.length, api.TOS_RESTRICTED_SOURCE_IDS.length);
  restricted.forEach((item) => {
    assert.equal(item.enabled, false);
    assert.equal(item.mode, 'alerts_only');
  });
});

test('the roster is small enough that every source runs at least weekly', () => {
  const callsPerDay = 6; // ~100 ILS/month at a realistic cost per call
  const rotating = api.getSourcesCatalog_()
    .filter((item) => item.enabled && item.type !== api.EMAIL_ALERT_SOURCE_TYPE);
  const daysPerLap = rotating.length / callsPerDay;
  assert.ok(daysPerLap <= 7, `roster of ${rotating.length} needs ${daysPerLap.toFixed(1)} days per lap`);
});

test('alert mail runs every time instead of waiting for a rotation slot', () => {
  const rows = [];
  for (let i = 0; i < 8; i += 1) {
    rows.push(sheetRow({
      source_id: `il_board_${i}`,
      priority: 1,
      status: 'active',
      last_run_at: new Date(NOW.getTime() - (i + 1) * DAY_MS),
    }));
  }
  rows.push(sheetRow({
    source_id: 'email_job_alerts',
    type: api.EMAIL_ALERT_SOURCE_TYPE,
    label: 'Job alert emails',
    query_or_url: 'JobAlerts',
    // Freshly run and therefore last in line if it had to compete for a slot.
    last_run_at: new Date(NOW.getTime() - 60 * 1000),
  }));

  const picked = api.readEnabledSources_(fakeSourcesSheet(rows), { maxSourceCallsPerRun: 3 });
  const ids = Array.from(picked).map((item) => item.source_id);

  assert.equal(ids[0], 'email_job_alerts', 'alert mail should be read before paid searches');
  assert.equal(ids.length, 4, 'it must not consume one of the three budgeted slots');
});
