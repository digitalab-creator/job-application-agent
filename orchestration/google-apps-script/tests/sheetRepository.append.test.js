const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const CONFIG = loadAppsScript(['Config.js'], ['CONFIG']).CONFIG;
const COLS = CONFIG.COLUMN_COUNT;

function makeRow(label) {
  const row = new Array(COLS).fill('');
  row[CONFIG.COL_INDEX.ROLE] = label;
  return row;
}

/**
 * Mimics Google Sheets: copyFormatToRange / setValues throw while a filter is active.
 */
function makeMockSheet() {
  const state = {
    lastRow: 1,
    maxRows: 1000,
    filterActive: true,
    filterRemovedDuringWrite: false,
    filterRestored: false,
    writtenRows: [],
    setValuesCallsWhileFiltered: 0,
  };

  const filterRange = {
    getNumColumns: () => COLS,
    createFilter: () => {
      state.filterActive = true;
      state.filterRestored = true;
      return {
        setColumnFilterCriteria: () => {},
      };
    },
  };

  const filter = {
    getRange: () => filterRange,
    getColumnFilterCriteria: (col) => ({ column: col, hiddenValues: ['x'] }),
    remove: () => {
      state.filterActive = false;
      state.filterRemovedDuringWrite = true;
    },
  };

  function range(row, col, numRows, numCols) {
    return {
      copyFormatToRange: () => {
        if (state.filterActive) {
          throw new Error('This operation is not supported on a range with a filtered-out row.');
        }
      },
      getDataValidations: () => [new Array(COLS).fill(null)],
      setDataValidations: () => {},
      setValues: (values) => {
        if (state.filterActive) {
          state.setValuesCallsWhileFiltered += 1;
          throw new Error('This operation is not supported on a range with a filtered-out row.');
        }
        state.writtenRows.push(...values);
        state.lastRow = Math.max(state.lastRow, row + values.length - 1);
      },
    };
  }

  return {
    state,
    getFilter: () => (state.filterActive ? filter : null),
    getLastRow: () => state.lastRow,
    getMaxRows: () => state.maxRows,
    insertRowsAfter: () => {},
    getRange: (row, col, numRows, numCols) => range(row, col, numRows, numCols),
  };
}

const api = loadAppsScript(['Config.js', 'SheetRepository.js'], ['appendRows_', 'ensureBasicFilterOff_']);

test('appendRows_ suspends a sheet filter for the write and restores it afterward', () => {
  const sheet = makeMockSheet();
  sheet.state.lastRow = 2;

  api.appendRows_(sheet, [makeRow('Growth lead'), makeRow('PM')]);

  assert.equal(sheet.state.setValuesCallsWhileFiltered, 0);
  assert.equal(sheet.state.filterRemovedDuringWrite, true);
  assert.equal(sheet.state.filterRestored, true);
  assert.equal(sheet.state.writtenRows.length, 2);
  assert.equal(sheet.state.writtenRows[0][CONFIG.COL_INDEX.ROLE], 'Growth lead');
});

test('appendRows_ is a no-op for empty input', () => {
  const sheet = makeMockSheet();
  api.appendRows_(sheet, []);
  assert.equal(sheet.state.writtenRows.length, 0);
});

test('ensureBasicFilterOff_ removes an active basic filter', () => {
  const sheet = makeMockSheet();
  assert.equal(api.ensureBasicFilterOff_(sheet), true);
  assert.equal(sheet.state.filterActive, false);
  assert.equal(api.ensureBasicFilterOff_(sheet), false);
});
