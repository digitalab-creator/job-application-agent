const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const COLUMN_COUNT = 17;
const JOB_URL = 13;
const STATUS = 14;
const NOTES = 16;

const routes = new Map();
const throwers = new Map();

function makeResponse(code, body, headers) {
  return {
    getResponseCode: () => code,
    getContentText: () => body || '',
    getAllHeaders: () => headers || {},
  };
}

function route(url) {
  if (throwers.has(url)) throw new Error(throwers.get(url));
  return routes.has(url) ? routes.get(url) : makeResponse(200, '<title>Growth Lead</title>Apply now.');
}

const UrlFetchApp = {
  fetchAll: (requests) => requests.map((request) => route(request.url)),
  fetch: (url) => route(url),
};

const properties = new Map();
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
    setProperty: (key, value) => properties.set(key, value),
  }),
};

const Utilities = { formatDate: () => '2026-08-08' };

/** Minimal in-memory stand-in for the slice of the Sheet API the recheck uses. */
function makeSheet(name, sheetId, initialRows) {
  const data = initialRows.map((row) => row.slice());

  return {
    __data: data,
    getName: () => name,
    getSheetId: () => sheetId,
    getLastRow: () => data.length + 1,
    getMaxRows: () => data.length + 1,
    insertRowsAfter: () => {},
    deleteRow: (rowNumber) => data.splice(rowNumber - 2, 1),
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => data
        .slice(row - 2, row - 2 + numRows)
        .map((entry) => entry.slice(col - 1, col - 1 + numCols)),
      setValues: (values) => values.forEach((entry, offset) => {
        const target = row - 2 + offset;
        if (!data[target]) data[target] = new Array(COLUMN_COUNT).fill('');
        entry.forEach((cell, column) => {
          data[target][col - 1 + column] = cell;
        });
      }),
      getDataValidations: () => [new Array(numCols).fill(null)],
      setDataValidations: () => {},
      copyFormatToRange: () => {},
    }),
  };
}

function makeRow(url, notes) {
  const row = new Array(COLUMN_COUNT).fill('');
  row[JOB_URL] = url;
  row[STATUS] = 'New';
  row[NOTES] = notes || '';
  return row;
}

const api = loadAppsScript(
  // SourcesRepository provides extractSourceIdFromNotes_, which the recheck uses to tell
  // a deliberate Facebook row from one a general search leaked in.
  ['Config.js', 'Utils.js', 'UrlInspector.js', 'LinkLiveness.js', 'SourcesRepository.js', 'SheetRepository.js'],
  ['recheckSheet_', 'readNoteTag_', 'setNoteTag_'],
  { UrlFetchApp, PropertiesService, Utilities }
);

test.beforeEach(() => {
  routes.clear();
  throwers.clear();
  properties.clear();
});

test('note tags round-trip and are cleared with an empty value', () => {
  assert.equal(api.setNoteTag_('source_id=il_janglo', 'unreachable', 2), 'source_id=il_janglo unreachable=2');
  assert.equal(api.readNoteTag_('source_id=il_janglo unreachable=2', 'unreachable'), '2');
  assert.equal(api.setNoteTag_('source_id=il_janglo unreachable=2', 'unreachable', 3), 'source_id=il_janglo unreachable=3');
  assert.equal(api.setNoteTag_('source_id=il_janglo unreachable=2', 'unreachable', ''), 'source_id=il_janglo');
  assert.equal(api.readNoteTag_('source_id=il_janglo', 'unreachable'), '');
});

test('a dead hostname moves the row to Closed on the first check', () => {
  const url = 'https://careers.varos.com/jobs/head-of-growth';
  throwers.set(url, 'DNS error: careers.varos.com');

  const jobs = makeSheet('Jobs', 1, [makeRow(url)]);
  const closed = makeSheet('Closed & Seen', 2, []);

  assert.equal(api.recheckSheet_(jobs, closed), 1);
  assert.equal(jobs.__data.length, 0);
  assert.equal(closed.__data[0][STATUS], 'Closed');
  assert.match(closed.__data[0][NOTES], /Host no longer exists/);
});

test('a timeout only earns a strike and leaves the row in place', () => {
  const url = 'https://acme.com/job/410001';
  throwers.set(url, 'Timeout: acme.com');

  const jobs = makeSheet('Jobs', 3, [makeRow(url, 'source_id=web_ats_lever')]);
  const closed = makeSheet('Closed & Seen', 4, []);

  assert.equal(api.recheckSheet_(jobs, closed), 0);
  assert.equal(jobs.__data.length, 1);
  assert.equal(jobs.__data[0][NOTES], 'source_id=web_ats_lever unreachable=1');
});

test('the third consecutive unreachable check closes the row', () => {
  const url = 'https://acme.com/job/420001';
  throwers.set(url, 'Timeout: acme.com');

  const jobs = makeSheet('Jobs', 5, [makeRow(url, 'unreachable=2')]);
  const closed = makeSheet('Closed & Seen', 6, []);

  assert.equal(api.recheckSheet_(jobs, closed), 1);
  assert.equal(jobs.__data.length, 0);
  assert.match(closed.__data[0][NOTES], /Unreachable on 3 consecutive checks/);
  assert.equal(api.readNoteTag_(closed.__data[0][NOTES], 'unreachable'), '');
});

test('a recovered page clears its earlier strikes', () => {
  const url = 'https://acme.com/job/430001';

  const jobs = makeSheet('Jobs', 7, [makeRow(url, 'source_id=web_ats_lever unreachable=2')]);
  const closed = makeSheet('Closed & Seen', 8, []);

  assert.equal(api.recheckSheet_(jobs, closed), 0);
  assert.equal(jobs.__data[0][NOTES], 'source_id=web_ats_lever');
});

test('a live row is left completely untouched', () => {
  const jobs = makeSheet('Jobs', 9, [makeRow('https://acme.com/job/440001', 'source_id=web_ats_lever')]);
  const closed = makeSheet('Closed & Seen', 10, []);

  assert.equal(api.recheckSheet_(jobs, closed), 0);
  assert.equal(jobs.__data.length, 1);
  assert.equal(jobs.__data[0][NOTES], 'source_id=web_ats_lever');
  assert.equal(jobs.__data[0][STATUS], 'New');
});

test('a Facebook post leaked in by a general search is retired', () => {
  const url = 'https://www.facebook.com/groups/1008911699849849/posts/1493222484082107/';

  const jobs = makeSheet('Freelance', 13, [makeRow(url, 'source_id=il_mploy')]);
  const closed = makeSheet('Closed & Seen', 14, []);

  assert.equal(api.recheckSheet_(jobs, closed), 1);
  assert.equal(jobs.__data.length, 0);
  assert.equal(closed.__data[0][STATUS], 'Closed');
  assert.match(closed.__data[0][NOTES], /cannot be read logged out/);
  assert.match(closed.__data[0][NOTES], /leaked from il_mploy/);
});

test('a Facebook post from a Facebook source is left alone', () => {
  const url = 'https://www.facebook.com/groups/1008911699849849/posts/1493222484082107/';

  const jobs = makeSheet('Freelance', 15, [makeRow(url, 'source_id=fb_marketing_il')]);
  const closed = makeSheet('Closed & Seen', 16, []);

  assert.equal(api.recheckSheet_(jobs, closed), 0);
  assert.equal(jobs.__data.length, 1);
  assert.equal(jobs.__data[0][STATUS], 'New');
});

test('retiring an unreadable row does not disturb the rows checked alongside it', () => {
  const leaked = 'https://www.facebook.com/groups/123/posts/456/';
  const live = 'https://acme.com/job/460001';

  const jobs = makeSheet('Freelance', 17, [makeRow(leaked, 'source_id=il_mploy'), makeRow(live, 'source_id=il_drushim')]);
  const closed = makeSheet('Closed & Seen', 18, []);

  assert.equal(api.recheckSheet_(jobs, closed), 1);
  assert.equal(jobs.__data.length, 1);
  assert.equal(jobs.__data[0][JOB_URL], live);
  assert.equal(jobs.__data[0][NOTES], 'source_id=il_drushim');
});

test('mixed rows are resolved independently in one pass', () => {
  const deadHost = 'https://careers.varos.com/jobs/head-of-growth';
  const flaky = 'https://acme.com/job/450002';
  const live = 'https://acme.com/job/450003';

  throwers.set(deadHost, 'DNS error: careers.varos.com');
  throwers.set(flaky, 'Timeout: acme.com');

  const jobs = makeSheet('Jobs', 11, [makeRow(deadHost), makeRow(flaky), makeRow(live)]);
  const closed = makeSheet('Closed & Seen', 12, []);

  assert.equal(api.recheckSheet_(jobs, closed), 1);
  assert.equal(jobs.__data.length, 2);
  assert.equal(jobs.__data[0][JOB_URL], flaky);
  assert.equal(jobs.__data[0][NOTES], 'unreachable=1');
  assert.equal(jobs.__data[1][JOB_URL], live);
});
