#!/usr/bin/env node
/**
 * Local backfill: migrate Est. Salary Range column + fill values + move low-salary jobs.
 * Uses clasp OAuth + Google Sheets API (same spreadsheet as CONFIG.SPREADSHEET_ID).
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const salary = require('../lib/salaryBenchmark');
const logic = require('../lib/opportunityLogic');

const SPREADSHEET_ID = 'REDACTED_SPREADSHEET_ID';
const SHEETS = {
  JOBS: 'Jobs',
  FREELANCE: 'Freelance',
  CLOSED: 'Closed & Seen',
};
const COL = {
  ROLE: 3,
  COMPANY: 4,
  CATEGORY: 5,
  LOCATION: 6,
  WORK_MODE: 7,
  SALARY: 8,
  EST_SALARY_RANGE: 9,
  WHY_IT_FITS: 11,
  SOURCE: 12,
  JOB_URL: 13,
  STATUS: 14,
  NOTES: 16,
};
const COLUMN_COUNT = 17;
const HEADERS = [
  'Unique Key', 'Found Date', 'Posted Date', 'Role', 'Company', 'Category',
  'Location', 'Work Mode', 'Salary', 'Est. Salary Range', 'Match Score',
  'Why It Fits', 'Source', 'Job URL', 'Status', 'Applied Date', 'Notes',
];
const MIN_MONTHLY_SALARY_ILS = 23000;
const CLASP_PROJECT_NUMBER = '1072944905499';

async function getAuthClient() {
  const claspRcPath = path.join(process.env.USERPROFILE || process.env.HOME, '.clasprc.json');
  const claspRc = JSON.parse(fs.readFileSync(claspRcPath, 'utf8'));
  const tokens = claspRc.tokens.default;
  const client = new google.auth.OAuth2(tokens.client_id, tokens.client_secret);
  client.setCredentials({ refresh_token: tokens.refresh_token });
  await client.getAccessToken();
  return client;
}

async function ensureSheetsApiEnabled(auth) {
  const serviceUsage = google.serviceusage({ version: 'v1', auth });
  const name = `projects/${CLASP_PROJECT_NUMBER}/services/sheets.googleapis.com`;
  try {
    await serviceUsage.services.enable({ name });
    console.log('Enabled Google Sheets API.');
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    if (!/already enabled/i.test(message)) throw error;
  }
}

function joinNotes(existing, extra) {
  return [logic.cleanString(existing), logic.cleanString(extra)].filter(Boolean).join(' | ');
}

function normalizeRow(row) {
  const normalized = row.slice(0, COLUMN_COUNT);
  while (normalized.length < COLUMN_COUNT) normalized.push('');
  return normalized;
}

function rowToCandidate(row, opportunityType) {
  const normalized = normalizeRow(row);
  const type = opportunityType || logic.classifyOpportunityType({
    role: logic.cleanString(normalized[COL.ROLE]),
    notes: logic.cleanString(normalized[COL.NOTES]),
    why_it_fits: logic.cleanString(normalized[COL.WHY_IT_FITS]),
    source: logic.cleanString(normalized[COL.SOURCE]),
    work_mode: logic.cleanString(normalized[COL.WORK_MODE]),
    opportunity_type: '',
  });

  return {
    role: logic.cleanString(normalized[COL.ROLE]),
    company: logic.cleanString(normalized[COL.COMPANY]),
    category: logic.cleanString(normalized[COL.CATEGORY]),
    location: logic.cleanString(normalized[COL.LOCATION]) || 'Not specified',
    work_mode: logic.cleanString(normalized[COL.WORK_MODE]) || 'Not specified',
    salary: logic.cleanString(normalized[COL.SALARY]) || 'Not listed',
    opportunity_type: type,
  };
}

function enrichRow(row, opportunityType) {
  const normalized = normalizeRow(row);
  const candidate = rowToCandidate(normalized, opportunityType);
  const estimate = salary.estimateSalaryRange(candidate);
  const newEst = estimate.display || '';
  const currentEst = logic.cleanString(normalized[COL.EST_SALARY_RANGE]);
  let notes = logic.cleanString(normalized[COL.NOTES]);
  let updated = false;

  if (newEst && newEst !== currentEst) {
    normalized[COL.EST_SALARY_RANGE] = newEst;
    updated = true;
  } else if (!currentEst && newEst) {
    normalized[COL.EST_SALARY_RANGE] = newEst;
    updated = true;
  }

  if (estimate.source
    && estimate.source !== 'Listed on posting'
    && !notes.includes('salary_est=')) {
    notes = joinNotes(notes, `salary_est=${estimate.source}`);
    normalized[COL.NOTES] = notes;
    updated = true;
  }

  return {
    row: normalized,
    updated,
    estDisplay: normalized[COL.EST_SALARY_RANGE] || newEst,
    notes,
  };
}

async function getSheetMeta(sheetsApi, title) {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find((item) => item.properties.title === title);
  if (!sheet) throw new Error(`Sheet not found: ${title}`);
  return sheet.properties;
}

async function migrateHeadersIfNeeded(sheetsApi, title) {
  const sheet = await getSheetMeta(sheetsApi, title);
  const headerRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!1:1`,
  });
  const headers = (headerRes.data.values && headerRes.data.values[0]) || [];

  if (headers[COL.SALARY] === 'Salary' && headers[COL.EST_SALARY_RANGE] === 'Match Score') {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          insertDimension: {
            range: {
              sheetId: sheet.sheetId,
              dimension: 'COLUMNS',
              startIndex: COL.EST_SALARY_RANGE,
              endIndex: COL.EST_SALARY_RANGE + 1,
            },
            inheritFromBefore: true,
          },
        }],
      },
    });
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${title}'!J1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Est. Salary Range']] },
    });
    console.log(`Migrated headers on ${title}`);
    return true;
  }

  if (!headers[COL.EST_SALARY_RANGE]) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${title}'!J1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Est. Salary Range']] },
    });
  }

  return false;
}

async function readDataRows(sheetsApi, title) {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A2:Q`,
  });
  return res.data.values || [];
}

async function writeDataRows(sheetsApi, title, rows) {
  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A2:Q`,
  });
  if (!rows.length) return;
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

async function appendRows(sheetsApi, title, rows) {
  if (!rows.length) return;
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${title}'!A:Q`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

function processSheetRows(rows, opportunityType, options) {
  const keptRows = [];
  const movedRows = [];
  let updated = 0;
  let purgedGhostRows = 0;
  const today = new Date().toISOString().slice(0, 10);

  rows.forEach((rawRow) => {
    const normalized = normalizeRow(rawRow);
    const isOpportunity = logic.isOpportunityRow({
      role: normalized[COL.ROLE],
      company: normalized[COL.COMPANY],
      jobUrl: normalized[COL.JOB_URL],
    });
    if (!isOpportunity) {
      purgedGhostRows += 1;
      return;
    }

    const enriched = enrichRow(rawRow, opportunityType);
    if (enriched.updated) updated += 1;

    if (options.applySalaryFloor) {
      const floor = salary.evaluateSalaryFloor(
        enriched.row[COL.SALARY],
        enriched.estDisplay,
        MIN_MONTHLY_SALARY_ILS
      );
      if (!floor.ok) {
        const movedRow = enriched.row.slice();
        const previousStatus = logic.cleanString(movedRow[COL.STATUS]);
        movedRow[COL.STATUS] = 'Closed';
        movedRow[COL.NOTES] = joinNotes(
          enriched.notes,
          `Moved from ${options.sheetName} on ${today}; below min salary (${floor.floor} ILS/mo); max~${floor.maxMonthlyIls} ILS/mo; previous status: ${previousStatus || 'blank'}`
        );
        movedRows.push(movedRow);
        return;
      }
    }

    keptRows.push(enriched.row);
  });

  return { keptRows, movedRows, updated, purgedGhostRows };
}

async function main() {
  const auth = await getAuthClient();
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const stats = {};

  for (const title of [SHEETS.JOBS, SHEETS.FREELANCE, SHEETS.CLOSED]) {
    await migrateHeadersIfNeeded(sheetsApi, title);
  }

  const jobsRows = await readDataRows(sheetsApi, SHEETS.JOBS);
  const jobsResult = processSheetRows(jobsRows, logic.OPPORTUNITY_TYPES.JOB, {
    applySalaryFloor: true,
    sheetName: SHEETS.JOBS,
  });
  await writeDataRows(sheetsApi, SHEETS.JOBS, jobsResult.keptRows);
  await appendRows(sheetsApi, SHEETS.CLOSED, jobsResult.movedRows);
  stats.jobs = {
    total: jobsRows.length,
    updated: jobsResult.updated,
    kept: jobsResult.keptRows.length,
    movedLowSalary: jobsResult.movedRows.length,
  };

  const freelanceRows = await readDataRows(sheetsApi, SHEETS.FREELANCE);
  const freelanceResult = processSheetRows(freelanceRows, logic.OPPORTUNITY_TYPES.FREELANCE, {
    applySalaryFloor: false,
    sheetName: SHEETS.FREELANCE,
  });
  await writeDataRows(sheetsApi, SHEETS.FREELANCE, freelanceResult.keptRows);
  stats.freelance = {
    total: freelanceRows.length,
    updated: freelanceResult.updated,
    kept: freelanceResult.keptRows.length,
  };

  const closedRows = await readDataRows(sheetsApi, SHEETS.CLOSED);
  const closedResult = processSheetRows(closedRows, '', {
    applySalaryFloor: false,
    sheetName: SHEETS.CLOSED,
  });
  await writeDataRows(sheetsApi, SHEETS.CLOSED, closedResult.keptRows);
  stats.closed = {
    total: closedRows.length,
    updated: closedResult.updated,
    kept: closedResult.keptRows.length,
  };

  stats.totalUpdated = stats.jobs.updated + stats.freelance.updated + stats.closed.updated;
  stats.totalMovedLowSalary = stats.jobs.movedLowSalary;
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error('Local backfill failed:', error.response?.data || error.message);
  process.exit(1);
});
