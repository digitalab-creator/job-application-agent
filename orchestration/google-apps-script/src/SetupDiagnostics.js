/**
 * Answers "is my API key really stored, and does it still work?" without guessing.
 * Also surfaces the script id and spreadsheet id, so a key stored in the wrong
 * script project is visible instead of looking like a key that vanished.
 */
const SECRET_VISIBLE_PREFIX = 10;
const SECRET_VISIBLE_SUFFIX = 4;

function showSetupStatus() {
  const report = buildSetupReport_();
  const text = report.join('\n');
  log_('INFO', 'Setup status checked.', text.replace(/\n/g, ' | '));

  const ui = tryGetUi_();
  if (ui) ui.alert('Setup status', text, ui.ButtonSet.OK);
  return text;
}

function buildSetupReport_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = cleanString_(props.getProperty(CONFIG.PROPS.OPENAI_API_KEY));
  const model = cleanString_(props.getProperty(CONFIG.PROPS.OPENAI_MODEL)) || `${CONFIG.DEFAULT_MODEL} (default)`;
  const email = cleanString_(props.getProperty(CONFIG.PROPS.NOTIFY_EMAIL)) || 'MISSING';

  return [
    `Script id: ${ScriptApp.getScriptId()}`,
    `Spreadsheet in Config: ${CONFIG.SPREADSHEET_ID}`,
    `Spreadsheet running this menu: ${activeSpreadsheetId_()}`,
    `Effective user: ${activeUserEmail_()}`,
    `${CONFIG.PROPS.OPENAI_API_KEY}: ${describeApiKey_(apiKey)}`,
    `${CONFIG.PROPS.OPENAI_MODEL}: ${model}`,
    `${CONFIG.PROPS.NOTIFY_EMAIL}: ${email}`,
    `All stored property keys: ${storedPropertyKeys_()}`,
    `Live key check: ${apiKey ? pingOpenAiKey_(apiKey) : 'skipped, no key stored'}`,
  ];
}

/**
 * Names only, never values. An empty store points at a different script project
 * or a wiped project; a populated store without the key points at the save path.
 */
function storedPropertyKeys_() {
  try {
    const keys = Object.keys(PropertiesService.getScriptProperties().getProperties());
    return keys.length ? keys.sort().join(', ') : 'NONE — the property store is completely empty';
  } catch (error) {
    return `unavailable: ${error}`;
  }
}

function activeUserEmail_() {
  try {
    return Session.getEffectiveUser().getEmail() || 'unknown';
  } catch (error) {
    return `unavailable: ${error}`;
  }
}

function describeApiKey_(apiKey) {
  if (!apiKey) return 'MISSING';
  const warnings = [];
  if (!isValidApiKey_(apiKey)) warnings.push(`does not start with ${CONFIG.OPENAI_KEY_PREFIX}`);
  if (apiKey !== normalizeApiKey_(apiKey)) warnings.push('contains whitespace or hidden characters');
  const suffix = warnings.length ? ` — WARNING: ${warnings.join('; ')}` : '';
  return `stored ${maskSecret_(apiKey)} (${apiKey.length} chars)${suffix}`;
}

function maskSecret_(value) {
  const text = cleanString_(value);
  if (text.length <= SECRET_VISIBLE_PREFIX + SECRET_VISIBLE_SUFFIX) return '***';
  return `${text.slice(0, SECRET_VISIBLE_PREFIX)}…${text.slice(-SECRET_VISIBLE_SUFFIX)}`;
}

function activeSpreadsheetId_() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    return active ? active.getId() : 'none (not running from a sheet)';
  } catch (error) {
    return `unavailable: ${error}`;
  }
}

/**
 * Listing models is free, so the check costs nothing but proves the key is live.
 */
function pingOpenAiKey_(apiKey) {
  try {
    const response = UrlFetchApp.fetch(CONFIG.OPENAI_MODELS_URL, {
      method: 'get',
      headers: { Authorization: `Bearer ${apiKey}` },
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) return 'OK, OpenAI accepted the key';
    return `FAILED with HTTP ${code}: ${truncate_(response.getContentText(), 300)}`;
  } catch (error) {
    return `FAILED to reach OpenAI: ${error}`;
  }
}
