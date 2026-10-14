const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppsScript } = require('./helpers/loadAppsScript');

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'UrlInspector.js'],
  ['isSpecificJobUrl_'],
  { SpreadsheetApp: {}, Utilities: {}, UrlFetchApp: {} }
);

test('Jobs!4750 GotFriends search-results URL is not a specific job URL', () => {
  const url = 'https://www.gotfriends.co.il/jobslobby/ai/?page=1&total=11';
  assert.equal(api.isSpecificJobUrl_(url), false);
});

test('GotFriends posting with posting id is specific', () => {
  const url = 'https://www.gotfriends.co.il/jobslobby/ai/ai-engineer/154895/';
  assert.equal(api.isSpecificJobUrl_(url), true);
});
