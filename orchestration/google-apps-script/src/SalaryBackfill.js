/**
 * Backfill Est. Salary Range on existing rows.
 * Jobs below MIN_MONTHLY_SALARY_ILS are moved to Closed & Seen.
 */
function backfillSalaryEstimates() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    throw new Error('Another run is in progress. Try again in a minute.');
  }

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheets = getRequiredSheets_(ss);
    const stats = backfillSalaryEstimates_(sheets);
    SpreadsheetApp.flush();
    log_('INFO', 'Salary backfill complete. Praise the FSM.', JSON.stringify(stats));
    return stats;
  } finally {
    lock.releaseLock();
  }
}

function backfillSalaryEstimates_(sheets) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const jobsStats = backfillOpportunitySheet_(
    sheets.jobs,
    sheets.closed,
    CONFIG.OPPORTUNITY_TYPES.JOB,
    { applySalaryFloor: true, today }
  );
  const freelanceStats = backfillOpportunitySheet_(
    sheets.freelance,
    null,
    CONFIG.OPPORTUNITY_TYPES.FREELANCE,
    { applySalaryFloor: false, today }
  );
  const closedStats = backfillOpportunitySheet_(
    sheets.closed,
    null,
    '',
    { applySalaryFloor: false, today }
  );

  return {
    jobs: jobsStats,
    freelance: freelanceStats,
    closed: closedStats,
    totalUpdated: jobsStats.updated + freelanceStats.updated + closedStats.updated,
    totalMovedLowSalary: jobsStats.movedLowSalary,
    totalPurgedGhostRows: jobsStats.purgedGhostRows
      + freelanceStats.purgedGhostRows
      + closedStats.purgedGhostRows,
  };
}

function normalizeOpportunityRow_(row) {
  const normalized = row.slice(0, CONFIG.COLUMN_COUNT);
  while (normalized.length < CONFIG.COLUMN_COUNT) normalized.push('');
  return normalized;
}

/**
 * A row only represents an opportunity when it carries an identity.
 * Rows holding nothing but a leftover Status value are sheet noise: enriching
 * them stamps a benchmark estimate on a row that has no posting behind it, and
 * the write itself makes the noise permanent by extending the sheet's last row.
 * Keep in sync with lib/opportunityLogic.js isOpportunityRow.
 */
function isOpportunityRow_(row) {
  const normalized = normalizeOpportunityRow_(row);
  return Boolean(
    cleanString_(normalized[CONFIG.COL_INDEX.ROLE])
    || cleanString_(normalized[CONFIG.COL_INDEX.COMPANY])
    || cleanString_(normalized[CONFIG.COL_INDEX.JOB_URL])
  );
}

function rowToSalaryCandidate_(row, opportunityType) {
  const normalized = normalizeOpportunityRow_(row);
  const type = opportunityType || classifyOpportunityType_({
    role: cleanString_(normalized[CONFIG.COL_INDEX.ROLE]),
    notes: cleanString_(normalized[CONFIG.COL_INDEX.NOTES]),
    why_it_fits: cleanString_(normalized[CONFIG.COL_INDEX.WHY_IT_FITS]),
    source: cleanString_(normalized[CONFIG.COL_INDEX.SOURCE]),
    work_mode: cleanString_(normalized[CONFIG.COL_INDEX.WORK_MODE]),
    opportunity_type: '',
  });

  return {
    role: cleanString_(normalized[CONFIG.COL_INDEX.ROLE]),
    company: cleanString_(normalized[CONFIG.COL_INDEX.COMPANY]),
    category: cleanString_(normalized[CONFIG.COL_INDEX.CATEGORY]),
    location: cleanString_(normalized[CONFIG.COL_INDEX.LOCATION]) || 'Not specified',
    work_mode: cleanString_(normalized[CONFIG.COL_INDEX.WORK_MODE]) || 'Not specified',
    salary: cleanString_(normalized[CONFIG.COL_INDEX.SALARY]) || 'Not listed',
    opportunity_type: type,
  };
}

function enrichRowSalaryFields_(row, opportunityType) {
  const normalized = normalizeOpportunityRow_(row);
  const candidate = rowToSalaryCandidate_(normalized, opportunityType);
  const salaryEstimate = estimateSalaryRange_(candidate);
  const newEst = salaryEstimate.display || '';
  const currentEst = cleanString_(normalized[CONFIG.COL_INDEX.EST_SALARY_RANGE]);
  let notes = cleanString_(normalized[CONFIG.COL_INDEX.NOTES]);
  let updated = false;

  if (newEst && newEst !== currentEst) {
    normalized[CONFIG.COL_INDEX.EST_SALARY_RANGE] = newEst;
    updated = true;
  } else if (!currentEst && newEst) {
    normalized[CONFIG.COL_INDEX.EST_SALARY_RANGE] = newEst;
    updated = true;
  }

  if (salaryEstimate.source
    && salaryEstimate.source !== 'Listed on posting'
    && notes.indexOf('salary_est=') < 0) {
    notes = joinNotes_(notes, `salary_est=${salaryEstimate.source}`);
    normalized[CONFIG.COL_INDEX.NOTES] = notes;
    updated = true;
  }

  return {
    row: normalized,
    updated,
    estDisplay: normalized[CONFIG.COL_INDEX.EST_SALARY_RANGE] || newEst,
    notes,
  };
}

function backfillOpportunitySheet_(sheet, closedSheet, opportunityType, options) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { updated: 0, movedLowSalary: 0, purgedGhostRows: 0, skipped: 0 };
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMN_COUNT).getValues();
  const keptRows = [];
  const rowsToMove = [];
  let updated = 0;
  let movedLowSalary = 0;
  let purgedGhostRows = 0;

  rows.forEach((rawRow) => {
    // Dropped from keptRows on purpose: the write-back below deletes the tail.
    if (!isOpportunityRow_(rawRow)) {
      purgedGhostRows += 1;
      return;
    }

    const enriched = enrichRowSalaryFields_(rawRow, opportunityType);
    if (enriched.updated) updated += 1;

    if (options.applySalaryFloor) {
      const floor = evaluateSalaryFloor_(
        enriched.row[CONFIG.COL_INDEX.SALARY],
        enriched.estDisplay
      );
      if (!floor.ok) {
        const movedRow = enriched.row.slice();
        const previousStatus = cleanString_(movedRow[CONFIG.COL_INDEX.STATUS]);
        movedRow[CONFIG.COL_INDEX.STATUS] = 'Closed';
        movedRow[CONFIG.COL_INDEX.NOTES] = joinNotes_(
          enriched.notes,
          `Moved from ${sheet.getName()} on ${options.today}; below min salary (${floor.floor} ILS/mo); max~${floor.maxMonthlyIls} ILS/mo; previous status: ${previousStatus || 'blank'}`
        );
        rowsToMove.push(movedRow);
        movedLowSalary += 1;
        return;
      }
    }

    keptRows.push(enriched.row);
  });

  if (options.applySalaryFloor && rowsToMove.length) {
    appendRows_(closedSheet, rowsToMove);
  }

  if (keptRows.length) {
    sheet.getRange(2, 1, keptRows.length, CONFIG.COLUMN_COUNT).setValues(keptRows);
    const extraRows = sheet.getLastRow() - (keptRows.length + 1);
    if (extraRows > 0) {
      sheet.deleteRows(keptRows.length + 2, extraRows);
    }
  } else if (rows.length) {
    sheet.deleteRows(2, rows.length);
  }

  if (purgedGhostRows) {
    log_(
      'INFO',
      `Purged ${purgedGhostRows} identity-less rows from ${sheet.getName()}.`,
      'Rows had no Role, Company or Job URL.'
    );
  }

  return {
    updated,
    movedLowSalary,
    purgedGhostRows,
    skipped: rows.length - keptRows.length - movedLowSalary - purgedGhostRows,
  };
}
