/**
 * Menu, setup, and daily trigger helpers.
 */
function onOpen() {
  maybeRunSalaryBackfillOnce_();
  SpreadsheetApp.getUi()
    .createMenu('Opportunity Automation')
    .addItem('Run now', 'runJobSearch')
    .addItem('Dry run (no sheet writes)', 'runJobSearchDryRun')
    .addItem('Setup API key and email', 'setupJobAutomation')
    .addItem('Check setup status', 'showSetupStatus')
    .addItem('Refresh source relevance stats', 'refreshSourceRelevanceStats')
    .addItem('Backfill salary estimates', 'backfillSalaryEstimates')
    .addItem('Sync all sources from catalog', 'syncSourcesEnablementFromCatalog')
    .addItem('Check job alert inbox', 'checkJobAlertInbox')
    .addItem('Check ATS company boards', 'checkAtsBoards')
    .addSeparator()
    .addItem('Install daily 08:00 trigger', 'installDailyTrigger')
    .addItem('Remove daily trigger', 'removeDailyTrigger')
    .addToUi();
}

/**
 * Interactive setup when run from the bound Sheet UI.
 * From the Apps Script editor alone, getUi() often fails — use setupFromScriptProperties instead.
 */
function setupJobAutomation() {
  const ui = tryGetUi_();
  if (!ui) {
    throw new Error([
      'Cannot show prompts from this editor context.',
      'Option A: open the bound Sheet → Extensions → Apps Script → run setupJobAutomation again.',
      'Option B: Project Settings → Script properties → set OPENAI_API_KEY, NOTIFY_EMAIL, OPENAI_MODEL',
      'then run setupFromScriptProperties.',
    ].join(' '));
  }

  const props = PropertiesService.getScriptProperties();

  const keyResult = ui.prompt(
    'OpenAI API key',
    'Paste the API key. It will be stored in Script Properties, not in the sheet. Arrr.',
    ui.ButtonSet.OK_CANCEL
  );
  if (keyResult.getSelectedButton() !== ui.Button.OK) return;

  const apiKey = normalizeApiKey_(keyResult.getResponseText());
  if (!isValidApiKey_(apiKey)) {
    ui.alert('That does not look like an OpenAI API key, matey. Nothing was saved.');
    return;
  }

  // Persist every answer the moment it is valid. Cancelling a later prompt must
  // never silently throw away a key the user already pasted.
  saveProperties_({ [CONFIG.PROPS.OPENAI_API_KEY]: apiKey });
  log_('INFO', 'OpenAI API key saved from the setup wizard.', `length=${apiKey.length}`);

  const defaultEmail = props.getProperty(CONFIG.PROPS.NOTIFY_EMAIL)
    || Session.getActiveUser().getEmail()
    || '';
  const emailResult = ui.prompt(
    'Digest email',
    `Where should new opportunity results be sent? Current value: ${defaultEmail || '(none)'}`,
    ui.ButtonSet.OK_CANCEL
  );
  if (emailResult.getSelectedButton() !== ui.Button.OK) {
    finishSetup_(ui, 'API key saved. Email and model were left unchanged.');
    return;
  }

  const notifyEmail = cleanString_(emailResult.getResponseText()) || defaultEmail;
  if (!isValidEmail_(notifyEmail)) {
    finishSetup_(ui, 'API key saved, but that email address is invalid so it was not stored.');
    return;
  }
  saveProperties_({ [CONFIG.PROPS.NOTIFY_EMAIL]: notifyEmail });

  const modelResult = ui.prompt(
    'OpenAI model',
    `Model name for Responses + web_search. Leave empty for the default: ${CONFIG.DEFAULT_MODEL}`,
    ui.ButtonSet.OK_CANCEL
  );
  const model = modelResult.getSelectedButton() === ui.Button.OK
    ? cleanString_(modelResult.getResponseText()) || CONFIG.DEFAULT_MODEL
    : CONFIG.DEFAULT_MODEL;
  saveProperties_({ [CONFIG.PROPS.OPENAI_MODEL]: model });

  finishSetup_(ui, 'Setup complete. Run "Check setup status", then a dry run, then install the daily trigger.');
}

function finishSetup_(ui, message) {
  ensureSetupSheets_();
  if (ui) ui.alert(message);
  log_('INFO', 'Setup wizard finished.', message);
}

/**
 * Editor-safe setup: read secrets already stored as Script Properties, then prepare sheets.
 * In Project Settings → Script properties, set:
 *   OPENAI_API_KEY, NOTIFY_EMAIL, and optionally OPENAI_MODEL
 * Then run this function.
 */
function setupFromScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = normalizeApiKey_(props.getProperty(CONFIG.PROPS.OPENAI_API_KEY));
  const notifyEmail = cleanString_(props.getProperty(CONFIG.PROPS.NOTIFY_EMAIL));
  const model = cleanString_(props.getProperty(CONFIG.PROPS.OPENAI_MODEL)) || CONFIG.DEFAULT_MODEL;

  if (!isValidApiKey_(apiKey)) {
    throw new Error(`Script property ${CONFIG.PROPS.OPENAI_API_KEY} is missing or invalid. Set it under Project Settings → Script properties.`);
  }
  if (!isValidEmail_(notifyEmail)) {
    throw new Error(`Script property ${CONFIG.PROPS.NOTIFY_EMAIL} is missing or invalid.`);
  }

  saveProperties_({
    [CONFIG.PROPS.OPENAI_API_KEY]: apiKey,
    [CONFIG.PROPS.OPENAI_MODEL]: model,
    [CONFIG.PROPS.NOTIFY_EMAIL]: notifyEmail,
  });
  ensureSetupSheets_();
  log_('INFO', 'Setup from Script Properties complete. Arrr.', `model=${model}; email=${notifyEmail}`);
}

/**
 * setProperties without deleteAllOthers, so one setting can never wipe another.
 */
function saveProperties_(values) {
  PropertiesService.getScriptProperties().setProperties(values);
}

function ensureSetupSheets_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  ensureLogSheet_(ss);
  getRequiredSheets_(ss);
}

/**
 * Pasting from a browser often drags in spaces, newlines or zero-width characters,
 * which turn a valid key into a silent 401.
 */
function normalizeApiKey_(value) {
  return cleanString_(value).replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

function isValidApiKey_(apiKey) {
  return cleanString_(apiKey).startsWith(CONFIG.OPENAI_KEY_PREFIX);
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanString_(email));
}

function tryGetUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (error) {
    console.log(`Arrr, getUi unavailable in this context: ${error}`);
    return null;
  }
}

function installDailyTrigger() {
  removeDailyTrigger();

  ScriptApp.newTrigger('runJobSearch')
    .timeBased()
    .atHour(8)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(CONFIG.TIME_ZONE)
    .create();

  log_('INFO', 'Arrr, installed the daily 08:00 opportunity-search trigger.', '');
}

function removeDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'runJobSearch')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
}

function maybeRunSalaryBackfillOnce_() {
  const props = PropertiesService.getScriptProperties();
  // Version 3 also purges identity-less rows that version 2 stamped estimates onto.
  if (props.getProperty('SALARY_BACKFILL_VERSION') === '3') return;

  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheets = getRequiredSheets_(ss);
    const stats = backfillSalaryEstimates_(sheets);
    SpreadsheetApp.flush();
    props.setProperty('SALARY_BACKFILL_VERSION', '3');
    log_('INFO', 'Auto salary backfill completed on sheet open.', JSON.stringify(stats));
  } catch (error) {
    log_('ERROR', 'Auto salary backfill failed on sheet open.', String(error));
  }
}

function validateSettings_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CONFIG.PROPS.OPENAI_API_KEY)) {
    throw new Error([
      `${CONFIG.PROPS.OPENAI_API_KEY} is not stored in this script project`,
      `(script id ${ScriptApp.getScriptId()}).`,
      `Property keys that are stored: ${storedPropertyKeys_()}.`,
      'Run "Opportunity Automation → Check setup status", then "Setup API key and email".',
    ].join(' '));
  }
}
