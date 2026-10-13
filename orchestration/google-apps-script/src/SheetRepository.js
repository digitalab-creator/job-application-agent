/**
 * Sheet persistence: Jobs, Freelance, Closed & Seen, Automation Log.
 */
function getRequiredSheets_(ss) {
  const jobs = ss.getSheetByName(CONFIG.SHEETS.JOBS);
  const searchConfig = ss.getSheetByName(CONFIG.SHEETS.SEARCH_CONFIG);
  const closed = ss.getSheetByName(CONFIG.SHEETS.CLOSED);

  if (!jobs || !searchConfig || !closed) {
    throw new Error('Required sheets are missing: Jobs, Search Config, or Closed & Seen.');
  }

  ensureBasicFilterOff_(jobs);
  ensureBasicFilterOff_(closed);

  const freelance = ensureOpportunitySheet_(ss, CONFIG.SHEETS.FREELANCE, jobs);
  ensureBasicFilterOff_(freelance);
  const sources = ensureSourcesSheet_(ss);
  validateOpportunityHeaders_(jobs, CONFIG.SHEETS.JOBS);
  validateOpportunityHeaders_(freelance, CONFIG.SHEETS.FREELANCE);
  ensureSearchConfigHeaders_(searchConfig);

  return { jobs, freelance, searchConfig, closed, sources };
}

function ensureOpportunitySheet_(ss, name, templateSheet) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, CONFIG.COLUMN_COUNT).setValues([CONFIG.HEADERS.slice()]);
    sheet.setFrozenRows(1);
    if (templateSheet && templateSheet.getLastRow() >= 2) {
      templateSheet.getRange(2, 1, 1, CONFIG.COLUMN_COUNT).copyFormatToRange(sheet, 1, CONFIG.COLUMN_COUNT, 2, 2);
      const validations = templateSheet.getRange(2, 1, 1, CONFIG.COLUMN_COUNT).getDataValidations();
      sheet.getRange(2, 1, 1, CONFIG.COLUMN_COUNT).setDataValidations(validations);
    }
  } else if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, CONFIG.COLUMN_COUNT).setValues([CONFIG.HEADERS.slice()]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function validateOpportunityHeaders_(sheet, label) {
  migrateOpportunityHeaders_(sheet);
  const headers = sheet.getRange(1, 1, 1, CONFIG.COLUMN_COUNT).getValues()[0].map(cleanString_);
  const expected = CONFIG.HEADERS;
  for (let i = 0; i < expected.length; i += 1) {
    if (!headers[i]) {
      sheet.getRange(1, i + 1).setValue(expected[i]);
      continue;
    }
    if (headers[i] !== expected[i]) {
      throw new Error(
        `${label} header mismatch at column ${i + 1}: expected "${expected[i]}", found "${headers[i]}".`
      );
    }
  }
}

function migrateOpportunityHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(cleanString_);
  const salaryIdx = CONFIG.COL_INDEX.SALARY;
  const estIdx = CONFIG.COL_INDEX.EST_SALARY_RANGE;
  const matchIdx = CONFIG.COL_INDEX.MATCH_SCORE;

  if (headers[salaryIdx] === 'Salary' && headers[estIdx] === 'Match Score') {
    sheet.insertColumnAfter(salaryIdx + 1);
    sheet.getRange(1, estIdx + 1).setValue(CONFIG.HEADERS[estIdx]);
    log_('INFO', `Migrated ${sheet.getName()} sheet: inserted "${CONFIG.HEADERS[estIdx]}" column.`);
    return;
  }

  if (headers[salaryIdx] === 'Salary' && !headers[estIdx] && headers[matchIdx] === 'Match Score') {
    sheet.getRange(1, estIdx + 1).setValue(CONFIG.HEADERS[estIdx]);
  }
}

function readExistingIndex_(jobsSheet, freelanceSheet, closedSheet) {
  const index = {
    keys: new Set(),
    urls: new Set(),
    contentIds: new Set(),
  };

  [jobsSheet, freelanceSheet, closedSheet].forEach((sheet) => {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMN_COUNT).getValues();
    rows.forEach((row) => {
      const key = cleanString_(row[0]).toLowerCase();
      const role = cleanString_(row[CONFIG.COL_INDEX.ROLE]);
      const company = cleanString_(row[CONFIG.COL_INDEX.COMPANY]);
      const url = normalizeUrl_(row[CONFIG.COL_INDEX.JOB_URL]);
      const source = cleanString_(row[CONFIG.COL_INDEX.SOURCE]);

      if (key) index.keys.add(key);
      if (url) {
        index.urls.add(url);
        index.contentIds.add(makeContentIdentity_(
          company,
          role,
          url,
          source,
          cleanString_(row[CONFIG.COL_INDEX.LOCATION])
        ));
      }
    });
  });

  return index;
}

function recheckExistingJobs_(jobsSheet, freelanceSheet, closedSheet) {
  return recheckSheet_(jobsSheet, closedSheet) + recheckSheet_(freelanceSheet, closedSheet);
}

function recheckSheet_(sourceSheet, closedSheet) {
  const lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) return 0;

  const rows = sourceSheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMN_COUNT).getValues();
  if (!rows.length) return 0;

  const props = PropertiesService.getScriptProperties();
  const offsetKey = `RECHECK_OFFSET_${sourceSheet.getSheetId()}`;
  let offset = Number(props.getProperty(offsetKey)) || 0;
  if (offset >= rows.length) offset = 0;

  const count = Math.min(CONFIG.MAX_EXISTING_RECHECK, rows.length);
  const selectedIndexes = [];
  for (let i = 0; i < count; i += 1) {
    selectedIndexes.push((offset + i) % rows.length);
  }

  const rowsToMove = [];
  const sheetRowsToDelete = [];
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');

  const checkable = [];
  // Rows whose page cannot be read are retired on provenance instead of evidence: a
  // search that leaked one can never have it disproven, so it would never leave.
  const unverifiable = [];
  selectedIndexes.forEach((arrayIndex) => {
    const url = cleanString_(rows[arrayIndex][CONFIG.COL_INDEX.JOB_URL]);
    if (!url || !isSpecificOpportunityUrl_(url, CONFIG.OPPORTUNITY_TYPES.JOB)) return;
    if (isUnverifiableUrl_(url)) {
      const sourceId = extractSourceIdFromNotes_(cleanString_(rows[arrayIndex][CONFIG.COL_INDEX.NOTES]));
      // Kept when the source was chosen for that platform: the user accepted then that
      // these cannot be verified, so removing them silently would be the surprise.
      if (!isFacebookSourceId_(sourceId)) unverifiable.push({ arrayIndex, sourceId });
      return;
    }
    checkable.push({ arrayIndex, url });
  });

  unverifiable.forEach((item) => {
    const row = rows[item.arrayIndex];
    const movedRow = row.slice();
    const previousStatus = cleanString_(movedRow[CONFIG.COL_INDEX.STATUS]);
    movedRow[CONFIG.COL_INDEX.STATUS] = 'Closed';
    movedRow[CONFIG.COL_INDEX.NOTES] = joinNotes_(
      cleanString_(row[CONFIG.COL_INDEX.NOTES]),
      `Moved from ${sourceSheet.getName()} on ${today}; previous status: ${previousStatus || 'blank'}; `
      + `page cannot be read logged out, so it can never be confirmed open`
      + `${item.sourceId ? ` (leaked from ${item.sourceId})` : ''}.`
    );
    rowsToMove.push(movedRow);
    sheetRowsToDelete.push(item.arrayIndex + 2);
  });

  const inspections = inspectJobUrls_(checkable.map((item) => item.url));

  const notesUpdates = [];

  checkable.forEach((item, position) => {
    const inspection = inspections[position];
    if (!inspection) return;

    const arrayIndex = item.arrayIndex;
    const row = rows[arrayIndex];
    const notes = cleanString_(row[CONFIG.COL_INDEX.NOTES]);
    const strikes = Number(readNoteTag_(notes, 'unreachable')) || 0;
    let closeReason = inspection.definitelyClosed ? inspection.reason : '';

    if (!closeReason && inspection.unreachable) {
      const nextStrikes = strikes + 1;
      if (nextStrikes < CONFIG.MAX_UNREACHABLE_STRIKES) {
        notesUpdates.push({ arrayIndex, notes: setNoteTag_(notes, 'unreachable', nextStrikes) });
        return;
      }
      closeReason = `Unreachable on ${nextStrikes} consecutive checks. ${inspection.reason}`;
    }

    if (!closeReason) {
      // The page loaded, so any earlier outage was temporary.
      if (strikes) notesUpdates.push({ arrayIndex, notes: setNoteTag_(notes, 'unreachable', '') });
      return;
    }

    const movedRow = row.slice();
    const previousStatus = cleanString_(movedRow[CONFIG.COL_INDEX.STATUS]);
    movedRow[CONFIG.COL_INDEX.STATUS] = 'Closed';
    movedRow[CONFIG.COL_INDEX.NOTES] = joinNotes_(
      setNoteTag_(notes, 'unreachable', ''),
      `Moved from ${sourceSheet.getName()} on ${today}; previous status: ${previousStatus || 'blank'}; ${closeReason}`
    );

    rowsToMove.push(movedRow);
    sheetRowsToDelete.push(arrayIndex + 2);
  });

  // Persist strike counts before deleting rows, so the row numbers still line up.
  writeNotesUpdates_(sourceSheet, rows, notesUpdates);
  appendRows_(closedSheet, rowsToMove);
  sheetRowsToDelete
    .sort((a, b) => b - a)
    .forEach((sheetRow) => sourceSheet.deleteRow(sheetRow));

  props.setProperty(offsetKey, String((offset + count) % Math.max(rows.length, 1)));
  return rowsToMove.length;
}

/** Rewrites the Notes column in one call, whatever the number of changed rows. */
function writeNotesUpdates_(sheet, rows, updates) {
  if (!updates || !updates.length) return;

  const column = rows.map((row) => [cleanString_(row[CONFIG.COL_INDEX.NOTES])]);
  updates.forEach((update) => {
    column[update.arrayIndex] = [update.notes];
  });

  sheet.getRange(2, CONFIG.COL_INDEX.NOTES + 1, column.length, 1).setValues(column);
}

/**
 * Sheet-level basic filters break automation writes; filter views are safe.
 * Call before any sheet touch so reads and writes do not hit "filtered-out row".
 */
function ensureBasicFilterOff_(sheet) {
  if (!sheet || typeof sheet.getFilter !== 'function') {
    return false;
  }
  const filter = sheet.getFilter();
  if (!filter) {
    return false;
  }
  filter.remove();
  log_(
    'INFO',
    `Removed basic filter on "${sheet.getName()}" before automation.`,
    'Use Data → Filter views for a saved view. Do not re-enable the sheet filter or appendRows_ will fail.',
  );
  return true;
}

/**
 * Sheet filters block copyFormatToRange/setValues on ranges that touch hidden rows.
 * Snapshot criteria, remove the filter for the write, then restore so the sheet view stays put.
 */
function suspendSheetFilterForWrite_(sheet) {
  if (!sheet || typeof sheet.getFilter !== 'function') {
    return { restore: function restoreNoop_() {} };
  }
  const filter = sheet.getFilter();
  if (!filter) {
    return { restore: function restoreNoop_() {} };
  }

  const filterRange = filter.getRange();
  const columnCount = filterRange.getNumColumns();
  const criteria = [];
  for (let col = 1; col <= columnCount; col += 1) {
    criteria.push(filter.getColumnFilterCriteria(col));
  }
  filter.remove();

  return {
    restore: function restoreSheetFilter_() {
      const restored = filterRange.createFilter();
      for (let col = 1; col <= columnCount; col += 1) {
        if (criteria[col - 1]) {
          restored.setColumnFilterCriteria(col, criteria[col - 1]);
        }
      }
    },
  };
}

function appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;

  const filterHandle = suspendSheetFilterForWrite_(sheet);
  try {
    const startRow = Math.max(sheet.getLastRow() + 1, 2);
    const requiredLastRow = startRow + rows.length - 1;
    if (requiredLastRow > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredLastRow - sheet.getMaxRows());
    }

    if (sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, 1, CONFIG.COLUMN_COUNT)
        .copyFormatToRange(sheet, 1, CONFIG.COLUMN_COUNT, startRow, requiredLastRow);
      const templateValidations = sheet.getRange(2, 1, 1, CONFIG.COLUMN_COUNT).getDataValidations()[0];
      const validationMatrix = rows.map(() => templateValidations.slice());
      sheet.getRange(startRow, 1, rows.length, CONFIG.COLUMN_COUNT).setDataValidations(validationMatrix);
    }

    sheet.getRange(startRow, 1, rows.length, CONFIG.COLUMN_COUNT).setValues(rows);
  } finally {
    filterHandle.restore();
  }
}

function ensureLogSheet_(spreadsheet) {
  const ss = spreadsheet || SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEETS.LOG);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.LOG);
    sheet.getRange(1, 1, 1, 4).setValues([['Timestamp', 'Level', 'Message', 'Details']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function log_(level, message, details) {
  try {
    const sheet = ensureLogSheet_();
    sheet.appendRow([new Date(), level, message, details || '']);
  } catch (error) {
    console.log(`Arrr, could not write to Automation Log: ${error}`);
  }
  console.log(`${level}: ${message}${details ? ` | ${details}` : ''}`);
}

function sheetUrlFor_(sheet) {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/edit#gid=${sheet.getSheetId()}`;
}
