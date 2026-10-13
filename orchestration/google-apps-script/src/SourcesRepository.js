/**
 * Sources sheet seed, load, and LLM vs user relevance stats.
 */

/**
 * Statuses written by older scheduling policies that parked a source instead of
 * only shrinking its share. They are revived with a clean measurement window so
 * the catalog stays the single source of truth for what is allowed to run.
 */
const PARKED_SOURCE_STATUSES = Object.freeze(['throttled', 'disabled_low_yield']);

function ensureSourcesSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEETS.SOURCES);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.SOURCES);
  }
  const headerRow = sheet.getRange(1, 1, 1, SOURCE_HEADERS.length).getValues()[0].map(cleanString_);
  if (!headerRow[0]) {
    sheet.getRange(1, 1, 1, SOURCE_HEADERS.length).setValues([SOURCE_HEADERS.slice()]);
    sheet.setFrozenRows(1);
  }
  seedSourcesSheet_(sheet);
  return sheet;
}

function seedSourcesSheet_(sheet) {
  const existing = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    ids.forEach((row) => {
      const id = cleanString_(row[0]);
      if (id) existing[id] = true;
    });
  }

  const toAppend = [];
  getSourcesCatalog_().forEach((source) => {
    if (existing[source.source_id]) return;
    toAppend.push(sourceToSeedRow_(source));
  });

  if (!toAppend.length) return;
  const start = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(start, 1, toAppend.length, SOURCE_HEADERS.length).setValues(toAppend);
}

function sourceToSeedRow_(source) {
  return [
    source.source_id,
    source.type,
    source.label,
    source.query_or_url,
    source.scrape_tier,
    source.mode,
    source.opportunity_types,
    source.enabled,
    source.priority,
    source.max_calls_per_run || 1,
    source.max_results || CONFIG.MAX_RESULTS_PER_BATCH,
    0, 0, 0, 0, '', '', 0, 0, 0, 0, 0, '', 'active', '', source.notes || '',
  ];
}

function readEnabledSources_(sheet, settings) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, SOURCE_HEADERS.length).getValues();
  const sources = [];

  rows.forEach((row, index) => {
    const sourceId = cleanString_(row[0]);
    if (!sourceId) return;

    const enabled = row[7] === true || String(row[7]).toUpperCase() === 'TRUE';
    const mode = cleanString_(row[5]) || 'auto';
    const status = cleanString_(row[23]) || 'active';
    const lastRunAt = row[24];

    const source = {
      rowNumber: index + 2,
      source_id: sourceId,
      type: cleanString_(row[1]),
      label: cleanString_(row[2]),
      query_or_url: cleanString_(row[3]),
      scrape_tier: cleanString_(row[4]),
      mode,
      opportunity_types: cleanString_(row[6]) || 'Both',
      enabled,
      priority: Number(row[8]) || 99,
      max_calls_per_run: Number(row[9]) || 1,
      max_results: Number(row[10]) || CONFIG.MAX_RESULTS_PER_BATCH,
      llm_relevant: Number(row[11]) || 0,
      user_relevant: Number(row[12]) || 0,
      user_not_relevant: Number(row[13]) || 0,
      user_pending: Number(row[14]) || 0,
      candidates_raw: Number(row[17]) || 0,
      duplicates: Number(row[18]) || 0,
      inaccessible: Number(row[19]) || 0,
      api_ms: Number(row[20]) || 0,
      runs: Number(row[21]) || 0,
      lastRunAt: toDateOrNull_(lastRunAt),
      status,
      freshWindow: false,
      notes: cleanString_(row[25]),
    };

    if (!enabled) return;
    if (mode !== 'auto') return;
    // Rows parked by an older policy get a fresh measurement window instead of an
    // instant penalty, so the current queries get a fair week.
    if (PARKED_SOURCE_STATUSES.indexOf(status) !== -1) {
      source.freshWindow = true;
      source.runs = 0;
    }
    sources.push(source);
  });

  const maxCalls = settings.maxSourceCallsPerRun || CONFIG.MAX_SOURCE_CALLS_PER_RUN;
  // Structured channels are read first and outside the rotation: they cost a fraction of
  // a web search, so making them wait their turn would delay results for no saving.
  const alwaysOn = sources.filter(isAlwaysOnSource_);
  const budgeted = sources.filter((source) => !isAlwaysOnSource_(source));
  return alwaysOn.concat(pickSourcesForRun_(budgeted, maxCalls, new Date()));
}

function isAlwaysOnSource_(source) {
  return ALWAYS_ON_SOURCE_TYPES.indexOf(source.type) !== -1;
}

function toDateOrNull_(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysSinceLastRun_(source, now) {
  const cap = 14;
  if (!source.lastRunAt) return cap;
  return (now.getTime() - source.lastRunAt.getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * Fraction of user-marked rows that are "Not Relevant". Needs a minimum sample
 * so one accidental mark cannot tank a source.
 */
function userNotRelevantRatio_(source) {
  const relevant = Number(source.user_relevant) || 0;
  const notRelevant = Number(source.user_not_relevant) || 0;
  const marked = relevant + notRelevant;
  const minMarked = Number(CONFIG.SOURCE_NOT_RELEVANT_MIN_MARKED) || 3;
  if (marked < minMarked) return 0;
  return notRelevant / marked;
}

function isZeroYieldPenalty_(source) {
  if (source.freshWindow) return false;
  const runs = Number(source.runs) || 0;
  const llm = Number(source.llm_relevant) || 0;
  const threshold = Number(CONFIG.SOURCE_ZERO_YIELD_DISABLE_RUNS) || 7;
  return runs >= threshold && llm === 0;
}

/**
 * Default share is equal (1). Only barren or user-rejected sources get a cut.
 */
function sourceShareWeight_(source) {
  const full = Number(CONFIG.SOURCE_SHARE_WEIGHT_DEFAULT) || 1;
  const penalty = Number(CONFIG.SOURCE_SHARE_WEIGHT_PENALTY) || 0.25;
  if (isZeroYieldPenalty_(source)) return penalty;
  const notRelevantCut = Number(CONFIG.SOURCE_NOT_RELEVANT_PENALTY_RATIO) || 0.7;
  if (userNotRelevantRatio_(source) >= notRelevantCut) return penalty;
  return full;
}

/**
 * Fair rotation: equal weight → least-recently-run first.
 * Penalized sources sort below full-share ones, so they only fill leftover slots.
 */
function pickSourcesForRun_(sources, maxCalls, now) {
  const slots = Math.max(0, Number(maxCalls) || 0);
  const ranked = sources.slice().sort((a, b) => {
    const weightDiff = sourceShareWeight_(b) - sourceShareWeight_(a);
    if (weightDiff !== 0) return weightDiff;
    const staleDiff = daysSinceLastRun_(b, now) - daysSinceLastRun_(a, now);
    if (staleDiff !== 0) return staleDiff;
    return a.source_id.localeCompare(b.source_id);
  });
  return ranked.slice(0, slots);
}

/**
 * Align existing Sources rows with the catalog enablement policy. Seeding only adds
 * new rows, so an already-seeded sheet needs this to pick up policy changes.
 * Rows parked by an older policy are revived; barren sources now lose share, not their slot.
 */
function syncSourcesEnablementFromCatalog() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ensureSourcesSheet_(ss);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    log_('WARN', 'Sources sheet empty; nothing to sync.', '');
    return;
  }

  const policyById = {};
  getSourcesCatalog_().forEach((source) => {
    policyById[source.source_id] = source;
  });

  const rowCount = lastRow - 1;
  // Type, label and URL are the source's definition, so the catalog owns them: a fixed
  // hostname there is inert until it reaches the row the run actually reads.
  const identityBlock = sheet.getRange(2, 2, rowCount, 3).getValues();
  const modeBlock = sheet.getRange(2, 6, rowCount, 3).getValues();
  const priorityBlock = sheet.getRange(2, 9, rowCount, 1).getValues();
  const statusBlock = sheet.getRange(2, 24, rowCount, 1).getValues();
  const ids = sheet.getRange(2, 1, rowCount, 1).getValues();

  let enabledCount = 0;
  let revivedCount = 0;
  const redefined = [];
  const retired = [];

  ids.forEach((idRow, index) => {
    const sourceId = cleanString_(idRow[0]);
    if (!sourceId) return;
    const policy = policyById[sourceId];

    // Dropped from the catalog: the row keeps its history but must never run again,
    // or it would call a provider this build no longer has.
    if (!policy) {
      if (modeBlock[index][2] === true || String(modeBlock[index][2]).toUpperCase() === 'TRUE') {
        retired.push(sourceId);
      }
      modeBlock[index][2] = false;
      statusBlock[index][0] = 'retired';
      return;
    }

    if (cleanString_(identityBlock[index][2]) !== cleanString_(policy.query_or_url)) {
      redefined.push(`${sourceId}: ${cleanString_(identityBlock[index][2])} -> ${policy.query_or_url}`);
    }
    identityBlock[index][0] = policy.type;
    identityBlock[index][1] = policy.label;
    identityBlock[index][2] = policy.query_or_url;

    modeBlock[index][0] = policy.mode;
    modeBlock[index][2] = policy.enabled;
    priorityBlock[index][0] = policy.priority;
    if (PARKED_SOURCE_STATUSES.indexOf(cleanString_(statusBlock[index][0])) !== -1) {
      statusBlock[index][0] = 'active';
      revivedCount += 1;
    }
    if (policy.enabled) enabledCount += 1;
  });

  sheet.getRange(2, 2, rowCount, 3).setValues(identityBlock);
  sheet.getRange(2, 6, rowCount, 3).setValues(modeBlock);
  sheet.getRange(2, 9, rowCount, 1).setValues(priorityBlock);
  sheet.getRange(2, 24, rowCount, 1).setValues(statusBlock);

  if (retired.length) console.log(`Arrr, retired ${retired.length} sources no longer in the catalog: ${retired.join(', ')}`);
  if (redefined.length) console.log(`Arrr, refreshed source URLs: ${redefined.join(' | ')}`);

  syncFreelanceIntentKeywordsPreference_();

  log_(
    'INFO',
    `Synced Sources from catalog: ${enabledCount} enabled, ${revivedCount} revived, ${retired.length} retired. Arrr.`,
    [
      `tos_restricted=${TOS_RESTRICTED_SOURCE_IDS.join(', ')}`,
      retired.length ? `retired=${retired.join(', ')}` : '',
      redefined.length ? `url_changes=${redefined.join(' | ')}` : '',
    ].filter(Boolean).join('\n')
  );
}

function syncFreelanceIntentKeywordsPreference_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SEARCH_CONFIG);
  if (!sheet) return;

  const intentValue = CONFIG.FREELANCE_INTENT_PHRASES.concat(CONFIG.FREELANCE_SKILL_TERMS).join('; ');
  const values = sheet.getDataRange().getValues();
  let foundRow = -1;
  for (let i = 1; i < values.length; i += 1) {
    if (cleanString_(values[i][6]) === 'facebook_keywords') {
      foundRow = i + 1;
      break;
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 8).setValue(intentValue);
  } else {
    sheet.appendRow(['', '', '', '', '', '', 'facebook_keywords', intentValue, '', '', '', '', '']);
  }
}

// Stats block spans llm_relevant (col 12) through notes (col 26), read and written
// as one range so a run costs two Sheets calls per source instead of fourteen.
const STATS_FIRST_COL = 12;
const STATS_COL_COUNT = 15;
const STATS_OFFSET = Object.freeze({
  LLM_RELEVANT: 0,
  CANDIDATES_RAW: 6,
  DUPLICATES: 7,
  INACCESSIBLE: 8,
  API_MS: 9,
  RUNS: 10,
  YIELD: 11,
  STATUS: 12,
  LAST_RUN_AT: 13,
  NOTES: 14,
});

function applySourceRunStats_(sheet, source, runStats) {
  const row = source.rowNumber;
  const range = sheet.getRange(row, STATS_FIRST_COL, 1, STATS_COL_COUNT);
  const stats = range.getValues()[0];

  function add(offset, delta) {
    return (Number(stats[offset]) || 0) + (Number(delta) || 0);
  }

  const llmDelta = Number(runStats.llm_relevant) || 0;
  const llm = add(STATS_OFFSET.LLM_RELEVANT, llmDelta);
  // A fresh measurement window restarts the counter so the current queries get a
  // full week before the source can be share-penalized.
  const runs = source.freshWindow ? 1 : add(STATS_OFFSET.RUNS, 1);
  const penaltyAfterRuns = Number(CONFIG.SOURCE_ZERO_YIELD_DISABLE_RUNS) || 7;

  let status = cleanString_(stats[STATS_OFFSET.STATUS]) || 'active';
  if (llmDelta > 0) {
    status = 'active';
  } else if (runs >= penaltyAfterRuns && llm === 0) {
    // Keep enabled — equal-share scheduler only gives this row a smaller weight.
    status = 'low_yield';
    stats[STATS_OFFSET.NOTES] = joinNotes_(
      cleanString_(stats[STATS_OFFSET.NOTES]),
      `low-yield ${Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd')}: 0 usable results in ${runs} runs; reduced share.`
    );
    console.log(`Arrr, source ${source.source_id} marked low_yield after ${runs} barren runs — smaller budget share.`);
  } else if (source.freshWindow) {
    status = 'active';
  }

  stats[STATS_OFFSET.LLM_RELEVANT] = llm;
  stats[STATS_OFFSET.CANDIDATES_RAW] = add(STATS_OFFSET.CANDIDATES_RAW, runStats.candidates_raw);
  stats[STATS_OFFSET.DUPLICATES] = add(STATS_OFFSET.DUPLICATES, runStats.duplicates);
  stats[STATS_OFFSET.INACCESSIBLE] = add(STATS_OFFSET.INACCESSIBLE, runStats.inaccessible);
  stats[STATS_OFFSET.API_MS] = add(STATS_OFFSET.API_MS, runStats.api_ms);
  stats[STATS_OFFSET.RUNS] = runs;
  stats[STATS_OFFSET.YIELD] = runs > 0 ? Math.round((llm / runs) * 100) / 100 : 0;
  stats[STATS_OFFSET.STATUS] = status;
  stats[STATS_OFFSET.LAST_RUN_AT] = new Date();

  range.setValues([stats]);
}

/**
 * Recompute user-marked relevance from Jobs + Freelance Status + source_id tag in Notes.
 */
function refreshUserRelevanceStats_(sourcesSheet, jobsSheet, freelanceSheet) {
  const counts = {};
  const lastSourceRow = sourcesSheet.getLastRow();
  if (lastSourceRow < 2) return;

  const sourceIds = sourcesSheet.getRange(2, 1, lastSourceRow - 1, 1).getValues()
    .map((row) => cleanString_(row[0]))
    .filter(Boolean);
  sourceIds.forEach((id) => {
    counts[id] = { user_relevant: 0, user_not_relevant: 0, user_pending: 0, llm_rows: 0 };
  });

  [jobsSheet, freelanceSheet].forEach((sheet) => {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const rows = sheet.getRange(2, 1, lastRow - 1, CONFIG.COLUMN_COUNT).getValues();
    rows.forEach((row) => {
      const notes = cleanString_(row[CONFIG.COL_INDEX.NOTES]);
      const status = cleanString_(row[CONFIG.COL_INDEX.STATUS]);
      const sourceId = extractSourceIdFromNotes_(notes);
      if (!sourceId || !counts[sourceId]) return;

      counts[sourceId].llm_rows += 1;
      if (CONFIG.USER_RELEVANT_STATUSES.indexOf(status) >= 0) {
        counts[sourceId].user_relevant += 1;
      } else if (status === CONFIG.USER_NOT_RELEVANT_STATUS) {
        counts[sourceId].user_not_relevant += 1;
      } else if (!status || status === 'New') {
        counts[sourceId].user_pending += 1;
      }
    });
  });

  // One read of llm_relevant and one write of the five relevance columns for all rows.
  const llmValues = sourcesSheet.getRange(2, 12, sourceIds.length, 1).getValues();
  const relevanceRows = sourceIds.map((id, index) => {
    const c = counts[id];
    const llmRelevant = Number(llmValues[index][0]) || c.llm_rows;
    const marked = c.user_relevant + c.user_not_relevant;
    return [
      c.user_relevant,
      c.user_not_relevant,
      c.user_pending,
      llmRelevant > 0 ? Math.round((c.user_relevant / llmRelevant) * 1000) / 10 : '',
      marked > 0 ? Math.round((c.user_relevant / marked) * 1000) / 10 : '',
    ];
  });

  sourcesSheet.getRange(2, 13, relevanceRows.length, 5).setValues(relevanceRows);
}

function extractSourceIdFromNotes_(notes) {
  return readNoteTag_(notes, 'source_id');
}

function tagSourceId_(notes, sourceId) {
  return setNoteTag_(notes, 'source_id', sourceId);
}
