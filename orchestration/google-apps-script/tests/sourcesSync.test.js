const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

/**
 * A grid-backed stand-in for a Sheets range API, enough for the sync to read and write
 * blocks of columns and to append seeded rows.
 */
function fakeSheet(grid) {
  return {
    grid,
    getLastRow: () => grid.length,
    setFrozenRows: () => {},
    getRange(startRow, startCol, numRows, numCols) {
      return {
        getValues: () => {
          const out = [];
          for (let r = 0; r < numRows; r += 1) {
            const row = grid[startRow - 1 + r] || [];
            out.push(row.slice(startCol - 1, startCol - 1 + numCols));
          }
          return out;
        },
        setValues: (values) => {
          values.forEach((row, r) => {
            const target = startRow - 1 + r;
            if (!grid[target]) grid[target] = [];
            row.forEach((value, c) => { grid[target][startCol - 1 + c] = value; });
          });
        },
      };
    },
  };
}

function build(rows) {
  // Only the Sources sheet exists here; every other lookup returns null so the
  // unrelated Search Config sync bows out on its own.
  const state = { sheet: null, sourcesName: '' };
  const api = loadAppsScript(
    ['Config.js', 'Utils.js', 'SourcesCatalog.js', 'SourcesRepository.js'],
    ['syncSourcesEnablementFromCatalog', 'SOURCE_HEADERS', 'getSourcesCatalog_', 'CONFIG'],
    {
      log_: () => {},
      Utilities: { formatDate: () => '2026-08-08' },
      SpreadsheetApp: {
        openById: () => ({
          getSheetByName: (name) => (name === state.sourcesName ? state.sheet : null),
          insertSheet: () => state.sheet,
        }),
      },
    }
  );

  const headers = Array.from(api.SOURCE_HEADERS);
  state.sourcesName = api.CONFIG.SHEETS.SOURCES;
  state.sheet = fakeSheet([headers].concat(rows(headers)));
  return { api, sheet: state.sheet, headers };
}

function row(headers, values) {
  const out = new Array(headers.length).fill('');
  Object.keys(values).forEach((key) => { out[headers.indexOf(key)] = values[key]; });
  return out;
}

function cell(sheet, headers, sourceId, column) {
  const found = sheet.grid.find((r) => r[0] === sourceId);
  assert.ok(found, `row ${sourceId} should exist`);
  return found[headers.indexOf(column)];
}

test('a source dropped from the catalog is disabled so it cannot call a missing provider', () => {
  const { api, sheet, headers } = build((h) => [
    row(h, {
      source_id: 'api_jooble', type: 'jooble_api', label: 'Jooble', enabled: true,
      mode: 'auto', status: 'active', llm_relevant: 4,
    }),
  ]);

  api.syncSourcesEnablementFromCatalog();

  assert.equal(cell(sheet, headers, 'api_jooble', 'enabled'), false);
  assert.equal(cell(sheet, headers, 'api_jooble', 'status'), 'retired');
  assert.equal(cell(sheet, headers, 'api_jooble', 'llm_relevant'), 4, 'history must survive retirement');
});

test('a corrected URL in the catalog reaches the row the run actually reads', () => {
  const { api, sheet, headers } = build((h) => [
    row(h, {
      source_id: 'il_comblack', type: 'web_jobs', label: 'Comblack',
      query_or_url: 'https://www.comblack.co.il/', enabled: true, mode: 'auto', status: 'active',
    }),
  ]);

  api.syncSourcesEnablementFromCatalog();

  assert.equal(cell(sheet, headers, 'il_comblack', 'query_or_url'), 'https://comblack.co.il/');
});

test('a hand-edited type or label is restored from the catalog', () => {
  const { api, sheet, headers } = build((h) => [
    row(h, {
      source_id: 'il_drushim', type: 'wrong_type', label: 'typo',
      query_or_url: 'https://example.invalid/', enabled: true, mode: 'auto', status: 'active',
    }),
  ]);

  api.syncSourcesEnablementFromCatalog();

  assert.equal(cell(sheet, headers, 'il_drushim', 'type'), 'web_jobs');
  assert.equal(cell(sheet, headers, 'il_drushim', 'label'), 'Drushim');
  assert.equal(cell(sheet, headers, 'il_drushim', 'query_or_url'), 'https://www.drushim.co.il/');
});

test('rostered sources end up enabled and parked ones revived', () => {
  const { api, sheet, headers } = build((h) => [
    row(h, {
      source_id: 'il_drushim', type: 'web_jobs', label: 'Drushim', enabled: false,
      mode: 'auto', status: 'disabled_low_yield',
    }),
  ]);

  api.syncSourcesEnablementFromCatalog();

  assert.equal(cell(sheet, headers, 'il_drushim', 'enabled'), true);
  assert.equal(cell(sheet, headers, 'il_drushim', 'status'), 'active');
});

test('a source outside the roster stays present but disabled, not retired', () => {
  const { api, sheet, headers } = build((h) => [
    row(h, {
      source_id: 'il_nisha', type: 'web_jobs', label: 'Nisha', enabled: true,
      mode: 'auto', status: 'active',
    }),
  ]);

  api.syncSourcesEnablementFromCatalog();

  assert.equal(cell(sheet, headers, 'il_nisha', 'enabled'), false);
  assert.notEqual(cell(sheet, headers, 'il_nisha', 'status'), 'retired');
});

test('the new ATS channel is seeded into a sheet that predates it', () => {
  const { api, sheet, headers } = build((h) => [
    row(h, { source_id: 'il_drushim', type: 'web_jobs', label: 'Drushim', enabled: true, mode: 'auto' }),
  ]);

  api.syncSourcesEnablementFromCatalog();

  assert.equal(cell(sheet, headers, 'api_ats_boards', 'enabled'), true);
  assert.equal(cell(sheet, headers, 'api_ats_boards', 'type'), 'ats_api');
});

test('every catalog source ends up on the sheet exactly once', () => {
  const { api, sheet } = build(() => []);

  api.syncSourcesEnablementFromCatalog();

  const ids = sheet.grid.slice(1).map((r) => r[0]).filter(Boolean);
  const catalogIds = Array.from(api.getSourcesCatalog_()).map((s) => s.source_id);
  assert.equal(ids.length, catalogIds.length);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate rows');
});
