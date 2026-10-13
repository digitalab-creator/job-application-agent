/**
 * Search Config reader.
 * A-E: categories | G-H: preferences | I-M: Facebook sources
 */
function readSearchConfig_(sheet) {
  const values = sheet.getDataRange().getValues();
  const categories = [];
  const preferences = {};
  const facebookSources = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const category = cleanString_(row[0]);
    const rawTitles = cleanString_(row[1]);
    const priority = Number(row[2]) || 2;
    const include = row[3] === true || String(row[3]).toUpperCase() === 'TRUE';
    const notes = cleanString_(row[4]);

    if (category && rawTitles && include) {
      categories.push({
        category,
        titles: rawTitles.split(';').map((title) => title.trim()).filter(Boolean),
        priority,
        notes,
      });
    }

    const preference = cleanString_(row[6]);
    const value = cleanString_(row[7]);
    if (preference && value) preferences[preference] = value;

    const facebookUrl = cleanString_(row[8]);
    if (facebookUrl) {
      facebookSources.push({
        url: facebookUrl,
        label: cleanString_(row[9]) || getDomain_(facebookUrl),
        enabled: row[10] === true || String(row[10]).toUpperCase() === 'TRUE' || cleanString_(row[10]) === '',
        category: cleanString_(row[11]) || 'Growth Marketing',
        priority: Number(row[12]) || 2,
      });
    }
  }

  categories.sort((a, b) => a.priority - b.priority || a.category.localeCompare(b.category));

  const enabledFacebook = facebookSources.filter((item) => item.enabled);
  const resolvedFacebook = enabledFacebook.length
    ? enabledFacebook
    : CONFIG.DEFAULT_FACEBOOK_SOURCES.map((item) => Object.assign({}, item));

  resolvedFacebook.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));

  return {
    categories,
    preferences,
    facebookSources: resolvedFacebook,
    settings: resolveRuntimeSettings_(preferences),
  };
}

function resolveRuntimeSettings_(preferences) {
  return {
    minMatchScore: parseNumberPreference_(
      preferences.min_match_score,
      CONFIG.MIN_MATCH_SCORE_DEFAULT
    ),
    maxAgeDays: parseNumberPreference_(
      preferences.max_age_days,
      CONFIG.MAX_AGE_DAYS_DEFAULT
    ),
    maxUrlVerifications: parseNumberPreference_(
      preferences.max_url_verifications,
      CONFIG.MAX_URL_VERIFICATIONS_DEFAULT
    ),
    enableWebSearch: parseBooleanPreference_(preferences.enable_web_search, true),
    enableFacebookSearch: parseBooleanPreference_(preferences.enable_facebook_search, true),
    facebookKeywords: cleanString_(preferences.facebook_keywords)
      || CONFIG.FREELANCE_INTENT_PHRASES.concat(CONFIG.FREELANCE_SKILL_TERMS).join('; '),
    dryRun: parseBooleanPreference_(preferences.dry_run, false),
    maxSourceCallsPerRun: parseNumberPreference_(
      preferences.max_source_calls_per_run,
      CONFIG.MAX_SOURCE_CALLS_PER_RUN
    ),
    monthlyBudgetIls: parseNumberPreference_(
      preferences.monthly_budget_ils,
      CONFIG.MONTHLY_BUDGET_ILS_DEFAULT
    ),
  };
}

function buildCategoryBatches_(categories) {
  const grouped = categories.reduce((acc, category) => {
    const key = String(category.priority);
    if (!acc[key]) acc[key] = [];
    acc[key].push(category);
    return acc;
  }, {});

  const batches = [];
  Object.keys(grouped)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((priority) => {
      chunk_(grouped[priority], 6).forEach((batch) => batches.push(batch));
    });

  return batches;
}

function ensureSearchConfigHeaders_(sheet) {
  const expectedLeft = ['Category', 'Titles', 'Priority', 'Include', 'Notes'];
  const current = sheet.getRange(1, 1, 1, 5).getValues()[0].map(cleanString_);
  const missing = expectedLeft.some((header, index) => current[index] && current[index] !== header);

  if (!cleanString_(sheet.getRange(1, 7).getValue())) {
    sheet.getRange(1, 7, 1, 2).setValues([['Preference', 'Value']]);
  }
  if (!cleanString_(sheet.getRange(1, 9).getValue())) {
    sheet.getRange(1, 9, 1, 5).setValues([[
      'Facebook Source URL',
      'Facebook Label',
      'Facebook Enabled',
      'Facebook Category',
      'Facebook Priority',
    ]]);
  }

  seedDefaultPreferences_(sheet);
  seedDefaultFacebookSources_(sheet);
  return !missing;
}

function seedDefaultPreferences_(sheet) {
  const values = sheet.getDataRange().getValues();
  const existing = {};
  for (let i = 1; i < values.length; i += 1) {
    const key = cleanString_(values[i][6]);
    if (key) existing[key] = true;
  }

  const defaults = [
    ['min_match_score', String(CONFIG.MIN_MATCH_SCORE_DEFAULT)],
    ['max_age_days', String(CONFIG.MAX_AGE_DAYS_DEFAULT)],
    ['max_url_verifications', String(CONFIG.MAX_URL_VERIFICATIONS_DEFAULT)],
    ['max_source_calls_per_run', String(CONFIG.MAX_SOURCE_CALLS_PER_RUN)],
    ['monthly_budget_ils', String(CONFIG.MONTHLY_BUDGET_ILS_DEFAULT)],
    ['enable_web_search', 'TRUE'],
    ['enable_facebook_search', 'TRUE'],
    ['dry_run', 'FALSE'],
    ['facebook_keywords', CONFIG.FREELANCE_INTENT_PHRASES.concat(CONFIG.FREELANCE_SKILL_TERMS).join('; ')],
  ];

  defaults.forEach((pair) => {
    if (existing[pair[0]]) return;
    sheet.appendRow(['', '', '', '', '', '', pair[0], pair[1], '', '', '', '', '']);
  });
}

function seedDefaultFacebookSources_(sheet) {
  const values = sheet.getDataRange().getValues();
  const existingUrls = new Set();
  for (let i = 1; i < values.length; i += 1) {
    const url = normalizeUrl_(values[i][8]);
    if (url) existingUrls.add(url);
  }

  CONFIG.DEFAULT_FACEBOOK_SOURCES.forEach((source) => {
    if (existingUrls.has(normalizeUrl_(source.url))) return;
    sheet.appendRow([
      '', '', '', '', '', '', '', '',
      source.url,
      source.label,
      true,
      source.category,
      source.priority,
    ]);
  });
}
